import { test } from "node:test";
import assert from "node:assert/strict";
import { isUniformColorBand } from "../src/utils/letterbox.js";

test("isUniformColorBand detects a solid black band", () => {
  const pixels = Array.from({ length: 100 }, () => [0, 0, 0]);
  assert.equal(isUniformColorBand(pixels), true);
});

test("isUniformColorBand detects a solid white band", () => {
  const pixels = Array.from({ length: 100 }, () => [255, 255, 255]);
  assert.equal(isUniformColorBand(pixels), true);
});

test("isUniformColorBand tolerates tiny compression-noise variation", () => {
  const pixels = Array.from({ length: 100 }, (_, i) => [i % 3, (i + 1) % 3, (i + 2) % 3]);
  assert.equal(isUniformColorBand(pixels), true);
});

test("isUniformColorBand rejects a textured/gradient region as not uniform", () => {
  const pixels = Array.from({ length: 100 }, (_, i) => [
    Math.round(Math.abs(Math.sin(i)) * 255),
    Math.round(Math.abs(Math.cos(i)) * 255),
    (i * 37) % 255
  ]);
  assert.equal(isUniformColorBand(pixels), false);
});

test("isUniformColorBand returns false for empty input", () => {
  assert.equal(isUniformColorBand([]), false);
  assert.equal(isUniformColorBand(null), false);
});

test("isUniformColorBand still detects a border band even when real photo content pokes into a minority of the strip (regression: BBC GOSSIP card)", () => {
  const blackBand = Array.from({ length: 85 }, () => [0, 0, 0]);
  const photoIntrusion = Array.from({ length: 15 }, (_, i) => [40 + i * 5, 30 + i * 4, 20 + i * 3]);
  assert.equal(isUniformColorBand([...blackBand, ...photoIntrusion]), true);
});

test("isUniformColorBand rejects a strip where the non-matching content is too large a fraction", () => {
  const blackBand = Array.from({ length: 50 }, () => [0, 0, 0]);
  const photoContent = Array.from({ length: 50 }, (_, i) => [(i * 5) % 255, (i * 7) % 255, (i * 11) % 255]);
  assert.equal(isUniformColorBand([...blackBand, ...photoContent]), false);
});
