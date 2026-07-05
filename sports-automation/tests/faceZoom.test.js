import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFaceCenter, mapPointThroughScaleCrop, buildZoompanFocusExpressions } from "../src/utils/faceZoom.js";

test("computeFaceCenter returns null for no faces", () => {
  assert.equal(computeFaceCenter([]), null);
  assert.equal(computeFaceCenter(null), null);
});

test("computeFaceCenter centers a single face box", () => {
  const center = computeFaceCenter([{ x: 100, y: 200, width: 50, height: 60 }]);
  assert.deepEqual(center, { x: 125, y: 230 });
});

test("computeFaceCenter spans the union of a group of faces", () => {
  const center = computeFaceCenter([
    { x: 0, y: 0, width: 20, height: 20 },
    { x: 180, y: 0, width: 20, height: 20 }
  ]);
  // union box spans x:0-200, y:0-20 -> center (100, 10)
  assert.deepEqual(center, { x: 100, y: 10 });
});

test("mapPointThroughScaleCrop maps the original image center to the canvas center", () => {
  const original = { width: 768, height: 1344 };
  const canvas = { width: 1080, height: 1920 };
  const point = { x: original.width / 2, y: original.height / 2 };
  const mapped = mapPointThroughScaleCrop(point, original, canvas);
  assert.ok(Math.abs(mapped.x - canvas.width / 2) < 0.01);
  assert.ok(Math.abs(mapped.y - canvas.height / 2) < 0.01);
});

test("mapPointThroughScaleCrop clamps points that fall in the cropped-away margin", () => {
  // A very wide source image crops heavily on the sides; a point near the original
  // left edge should clamp to 0 in the final canvas, not go negative.
  const original = { width: 2000, height: 1000 };
  const canvas = { width: 1080, height: 1920 };
  const point = { x: 0, y: 500 };
  const mapped = mapPointThroughScaleCrop(point, original, canvas);
  assert.equal(mapped.x, 0);
  assert.ok(mapped.x >= 0 && mapped.x <= canvas.width);
  assert.ok(mapped.y >= 0 && mapped.y <= canvas.height);
});

test("mapPointThroughScaleCrop never returns coordinates outside the canvas", () => {
  const original = { width: 400, height: 300 };
  const canvas = { width: 1080, height: 1920 };
  for (const point of [{ x: 0, y: 0 }, { x: 400, y: 300 }, { x: 200, y: 150 }]) {
    const mapped = mapPointThroughScaleCrop(point, original, canvas);
    assert.ok(mapped.x >= 0 && mapped.x <= canvas.width);
    assert.ok(mapped.y >= 0 && mapped.y <= canvas.height);
  }
});

test("buildZoompanFocusExpressions produces valid ffmpeg expression strings", () => {
  const exprs = buildZoompanFocusExpressions({ x: 540, y: 960 });
  assert.match(exprs.x, /^min\(max\(540\.00-\(iw\/zoom\/2\),0\),iw-iw\/zoom\)$/);
  assert.match(exprs.y, /^min\(max\(960\.00-\(ih\/zoom\/2\),0\),ih-ih\/zoom\)$/);
});
