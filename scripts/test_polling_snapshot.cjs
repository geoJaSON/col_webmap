const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../lib/pollingSnapshot.ts");
const loaded = new Module(filename, module);
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(ts.transpileModule(fsSync.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { chunksInView, PollingSnapshotCache, fetchPollingSnapshot } = loaded.exports;

async function main() {
  const fixture = {
    version: 1, snapshotId: "0123456789abcdef", chunkZoom: 2,
    chunks: [{ x: 1, y: 1, features: 1 }, { x: 2, y: 1, features: 1 }],
  };
  const westView = [-80, 5, -20, 40];
  assert.deepEqual(chunksInView(fixture, westView).map((chunk) => chunk.x), [1]);
  assert.equal(chunksInView(fixture, [-1, 5, 1, 40]).length, 2, "both sides of a partition boundary");
  assert.equal(chunksInView(fixture, [120, -30, 130, -20]).length, 0);
  let calls = 0;
  let fail = false;
  global.fetch = async (url, options) => {
    assert.ok(url.startsWith("/polling/"), "snapshot requests stay on this map");
    assert.equal(options.headers, undefined, "no Supabase token or key");
    options.signal.throwIfAborted();
    calls++;
    return { ok: !fail, json: async () => ({ type: "FeatureCollection", features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [-50, 20] }, properties: { substrate: "Mud" } },
    ] }) };
  };
  const cache = new PollingSnapshotCache(fixture);
  const signal = new AbortController().signal;
  assert.equal((await cache.load(westView, signal)).features.length, 1);
  assert.equal(calls, 1);
  await cache.load(westView, signal);
  assert.equal(calls, 1, "returning to a viewport uses cached data");
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(cache.load(westView, cancelled.signal), { name: "AbortError" });
  assert.equal(calls, 1, "cancelled viewport never fetches");
  fail = true;
  await assert.rejects(new PollingSnapshotCache(fixture).load(westView, signal), /could not load/);
  fail = false;
  await assert.rejects(new PollingSnapshotCache({ ...fixture, chunks: [{ x: 1, y: 1, features: 2 }] }).load(westView, signal), /incomplete/);

  // Load the actual published files through the browser's loader. This also
  // verifies that the manifest points to complete files, with no remote API.
  global.fetch = async (url, options) => {
    assert.ok(url.startsWith("/polling/") && !url.includes(".."));
    options.signal.throwIfAborted();
    return { ok: true, json: async () => JSON.parse(await fs.readFile(path.resolve(__dirname, "../public" + url), "utf8")) };
  };
  const metadata = await fetchPollingSnapshot(signal);
  const all = await new PollingSnapshotCache(metadata).load([-98, 27, -94, 31], signal);
  assert.equal(all.features.length, metadata.features);
  assert.equal(new Set(all.features.map((feature) => feature.id)).size, metadata.features);
  console.log(`Snapshot loader passed: viewport edges, cache, cancellation, errors, ${metadata.features.toLocaleString()} static points.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
