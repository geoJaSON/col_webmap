"use client";

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import { boundsOf, toFeatureCollection } from "@/lib/geo";
import { STATUS_COLORS, type Application } from "@/lib/types";

const SOURCE = "col";
const FILL = "col-fill";
const LINE = "col-line";
const PICK = "col-pick";
const SELECTED = "col-selected";
const LABEL = "col-label";

/**
 * Three raster basemaps live in the style at once and are toggled by
 * visibility. Switching with setStyle would tear down the polygon layers and
 * force them to be rebuilt on every tap.
 */
const DEFAULT_BASEMAP = "chart";

const BASEMAPS = [
  {
    // NOAA's Maritime Chart Service, drawn on demand as WMS rather than from
    // their RNC tile service (tileservice.charts.noaa.gov resolves but no
    // longer answers). Layers 0-6 are the chart proper; adding 7-12 buries it
    // under zone-of-confidence diamonds.
    id: "chart",
    label: "Chart",
    tiles: [
      "https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/NOAAChartDisplay/MapServer" +
        "/exts/MaritimeChartService/WMSServer?service=WMS&version=1.3.0&request=GetMap" +
        "&layers=0,1,2,3,4,5,6&styles=&crs=EPSG:3857&bbox={bbox-epsg-3857}" +
        "&width=256&height=256&format=image/png&transparent=true",
    ],
    attribution: "Charts © NOAA Office of Coast Survey",
    maxzoom: 17,
  },
  {
    id: "satellite",
    label: "Satellite",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    maxzoom: 19,
  },
  {
    id: "light",
    label: "Plain",
    tiles: ["https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"],
    attribution: "© OpenStreetMap contributors © CARTO",
    maxzoom: 19,
  },
] as const;

type BasemapId = (typeof BASEMAPS)[number]["id"];

const statusColor: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "status"],
  "Accept",
  STATUS_COLORS.Accept,
  "Modify",
  STATUS_COLORS.Modify,
  "Decline",
  STATUS_COLORS.Decline,
  "#8899a6",
];

/**
 * Padding for fitBounds. A phone has far less room to give away than a
 * desktop, and its lower third is taken by the sheet peek and the detail card,
 * so the frame is biased upward rather than centred underneath them. On a wide
 * screen the equivalent obstruction is the detail card in the bottom-right.
 */
function framePadding(avoidDetailCard = false): maplibregl.PaddingOptions {
  if (typeof window === "undefined") return { top: 60, left: 60, right: 60, bottom: 60 };
  if (window.innerWidth < 900) {
    return { top: 26, left: 26, right: 26, bottom: avoidDetailCard ? 330 : 216 };
  }
  return { top: 80, left: 80, right: avoidDetailCard ? 380 : 80, bottom: 90 };
}

type Props = {
  applications: Application[];
  visibleIds: number[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  detailOpen: boolean;
  /** The detail card, positioned against the map frame. */
  children?: React.ReactNode;
};

export default function MapCanvas({
  applications,
  visibleIds,
  selectedId,
  onSelect,
  detailOpen,
  children,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<BasemapId>(DEFAULT_BASEMAP);

  // Latest values for handlers that are registered once.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: Object.fromEntries(
          BASEMAPS.map((b) => [
            `base-${b.id}`,
            {
              type: "raster" as const,
              tiles: [...b.tiles],
              tileSize: 256,
              maxzoom: b.maxzoom,
              attribution: b.attribution,
            },
          ]),
        ),
        layers: BASEMAPS.map((b) => ({
          id: `base-${b.id}`,
          type: "raster" as const,
          source: `base-${b.id}`,
          layout: { visibility: b.id === DEFAULT_BASEMAP ? ("visible" as const) : ("none" as const) },
        })),
      },
      // The whole Texas mid-coast, so the first paint is already in the right place.
      bounds: [
        [-97.1, 27.9],
        [-94.5, 29.7],
      ],
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true },
    });

    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    instance.addControl(
      new maplibregl.ScaleControl({ maxWidth: 120, unit: "imperial" }),
      "bottom-left",
    );

    instance.on("load", () => {
      instance.addSource(SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      instance.addLayer({
        id: FILL,
        type: "fill",
        source: SOURCE,
        paint: { "fill-color": statusColor, "fill-opacity": 0.42 },
      });

      instance.addLayer({
        id: LINE,
        type: "line",
        source: SOURCE,
        paint: { "line-color": statusColor, "line-width": 1.8 },
      });

      // A wide, invisible line under the finger: 4px outlines are hard to hit
      // on a phone, so this gives every lease a fat tap target.
      instance.addLayer({
        id: PICK,
        type: "line",
        source: SOURCE,
        paint: { "line-color": "#000", "line-opacity": 0, "line-width": 22 },
      });

      instance.addLayer({
        id: SELECTED,
        type: "line",
        source: SOURCE,
        filter: ["==", ["get", "id"], -1],
        paint: {
          "line-color": "#f7f4ec",
          "line-width": 3,
          "line-dasharray": [2, 1.4],
        },
      });

      instance.addLayer({
        id: LABEL,
        type: "symbol",
        source: SOURCE,
        minzoom: 10,
        layout: {
          "text-field": ["to-string", ["get", "id"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#0f1d26",
          "text-halo-color": "#f7f4ec",
          "text-halo-width": 1.7,
        },
      });

      const pick = (event: maplibregl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (feature?.properties) onSelectRef.current(Number(feature.properties.id));
      };
      instance.on("click", FILL, pick);
      instance.on("click", PICK, pick);

      // Tapping bare water clears the selection.
      instance.on("click", (event) => {
        const hits = instance.queryRenderedFeatures(event.point, { layers: [FILL, PICK] });
        if (hits.length === 0) onSelectRef.current(null);
      });

      for (const layer of [FILL, PICK]) {
        instance.on("mouseenter", layer, () => {
          instance.getCanvas().style.cursor = "pointer";
        });
        instance.on("mouseleave", layer, () => {
          instance.getCanvas().style.cursor = "";
        });
      }

      setReady(true);
    });

    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  // Feed the source. Runs on every status edit so recolouring is immediate.
  useEffect(() => {
    if (!ready || !map.current) return;
    const source = map.current.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(toFeatureCollection(applications));
  }, [ready, applications]);

  // Hide anything filtered out rather than removing it from the source, so the
  // source stays stable and the filter is a cheap style update.
  useEffect(() => {
    if (!ready || !map.current) return;
    const filter: maplibregl.FilterSpecification = [
      "in",
      ["get", "id"],
      ["literal", visibleIds],
    ];
    for (const layer of [FILL, LINE, PICK, LABEL]) {
      map.current.setFilter(layer, filter);
    }
  }, [ready, visibleIds]);

  useEffect(() => {
    if (!ready || !map.current) return;
    map.current.setFilter(SELECTED, ["==", ["get", "id"], selectedId ?? -1]);
  }, [ready, selectedId]);

  // Frame the filtered set whenever the filter changes -- picking one owner
  // should take you to their leases without a manual pan.
  const filterKey = visibleIds.join(",");
  useEffect(() => {
    if (!ready || !map.current) return;
    const shown = applications.filter((a) => visibleIds.includes(a.id));
    const bounds = boundsOf(shown);
    if (!bounds) return;
    map.current.fitBounds(bounds, { padding: framePadding(), maxZoom: 14, duration: 600 });
    // Deliberately keyed on the filter only: re-framing on every status edit
    // would yank the map out from under whoever is working through a list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, filterKey]);

  // Centre the selected lease when it is picked from the list or the ledger.
  useEffect(() => {
    if (!ready || !map.current || selectedId === null) return;
    const target = applications.find((a) => a.id === selectedId);
    if (!target) return;
    const bounds = boundsOf([target]);
    if (!bounds) return;
    // Selecting always opens the detail card, so always frame clear of it.
    map.current.fitBounds(bounds, {
      padding: framePadding(true),
      maxZoom: 14,
      duration: 600,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedId]);

  useEffect(() => {
    if (!ready || !map.current) return;
    for (const b of BASEMAPS) {
      map.current.setLayoutProperty(
        `base-${b.id}`,
        "visibility",
        b.id === basemap ? "visible" : "none",
      );
    }
  }, [ready, basemap]);

  return (
    <div className="map" data-detail={detailOpen}>
      <div className="map__canvas" ref={container} />
      <div className="basemaps" role="group" aria-label="Basemap">
        {BASEMAPS.map((b) => (
          <button
            key={b.id}
            type="button"
            className="basemap"
            data-on={basemap === b.id}
            aria-pressed={basemap === b.id}
            onClick={() => setBasemap(b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}
