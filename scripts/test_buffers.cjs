// Exercise the same TypeScript buffer implementation used by the map.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../lib/buffer.ts");
const loaded = new Module(filename, module);
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { bufferInView, indexCategory, bboxOfGeometry } = loaded.exports;

const line = (coordinates) => ({
  type: "Feature", properties: {}, geometry: { type: "LineString", coordinates },
});
const indexed = (...features) => indexCategory({ type: "FeatureCollection", features });
const sample = indexed(line([[-96.001, 29], [-95.999, 29]]));
const view = [-96.01, 28.99, -95.99, 29.01];
const buffered = bufferInView(sample, 500, view);
assert.equal(buffered.features.length, 1);
const [, south, , north] = bboxOfGeometry(buffered.features[0].geometry);
const metersPerDegree = Math.PI * 6371008.8 / 180;
assert.ok(Math.abs((north - 29) * metersPerDegree - 152.4) < 0.1, "500 ft north of centerline");
assert.ok(Math.abs((29 - south) * metersPerDegree - 152.4) < 0.1, "500 ft south of centerline");
assert.equal(bufferInView(sample, 0, view).features.length, 0, "zero switches the buffer off");

const edgeView = [0, 0, 0.01, 0.01];
const outside = indexed(line([[0.0105, 0.002], [0.0105, 0.008]]));
const edgeBuffer = bufferInView(outside, 500, edgeView);
assert.equal(edgeBuffer.features.length, 1, "nearby offscreen pipeline is buffered");
assert.ok(bboxOfGeometry(edgeBuffer.features[0].geometry)[0] < edgeView[2], "buffer reaches viewport");
assert.equal(bufferInView(indexed(line([[1, 1], [1.1, 1]])), 500, edgeView).features.length, 0);

const multi = { type: "Feature", properties: {}, geometry: {
  type: "MultiLineString", coordinates: [[[-96.001, 29], [-95.999, 29]], [[-96.001, 29.005], [-95.999, 29.005]]],
} };
assert.equal(bufferInView(indexed(multi), 500, view).features.length, 1, "multipart pipelines are supported");
const restoration = { type: "Feature", properties: {}, geometry: {
  type: "Polygon", coordinates: [[[-96.001, 29], [-95.999, 29], [-95.999, 29.002], [-96.001, 29.002], [-96.001, 29]]],
} };
assert.equal(bufferInView(indexed(restoration), 1000, view).features.length, 1, "restoration buffers still work");

const shorelineBuffer = bufferInView(sample, 1000, view);
const [, shorelineSouth, , shorelineNorth] = bboxOfGeometry(shorelineBuffer.features[0].geometry);
assert.ok(Math.abs((shorelineNorth - 29) * metersPerDegree - 304.8) < 0.1, "1,000 ft north of shoreline");
assert.ok(Math.abs((29 - shorelineSouth) * metersPerDegree - 304.8) < 0.1, "1,000 ft south of shoreline");
const shorelines = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../public/layers/shorelines.geojson"), "utf8"));
const shorelineIndex = indexCategory(shorelines);
const fullView = [-98, 27, -94, 31];
const actualBuffers = bufferInView(shorelineIndex, 1000, fullView);
assert.equal(actualBuffers.features.length, shorelines.features.length, "every published shoreline buffers successfully");
for (const feature of actualBuffers.features) {
  assert.ok(["Polygon", "MultiPolygon"].includes(feature.geometry.type));
  assert.ok(bboxOfGeometry(feature.geometry).every(Number.isFinite));
}
console.log("Buffer checks passed: 500/1,000 ft each side, zero, viewport edge, distant culling, multipart, polygon, published shorelines.");
