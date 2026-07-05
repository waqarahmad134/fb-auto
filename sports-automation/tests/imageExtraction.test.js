import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOgImage } from "../src/pipeline/image-extraction.js";

test("extractOgImage finds property-then-content order", () => {
  const html = `<html><head><meta property="og:image" content="https://example.com/a.jpg"></head></html>`;
  assert.equal(extractOgImage(html), "https://example.com/a.jpg");
});

test("extractOgImage finds content-then-property order", () => {
  const html = `<meta content="https://example.com/b.jpg" property="og:image">`;
  assert.equal(extractOgImage(html), "https://example.com/b.jpg");
});

test("extractOgImage handles single quotes", () => {
  const html = `<meta property='og:image' content='https://example.com/c.jpg'>`;
  assert.equal(extractOgImage(html), "https://example.com/c.jpg");
});

test("extractOgImage falls back to twitter:image", () => {
  const html = `<meta name="twitter:image" content="https://example.com/d.jpg">`;
  assert.equal(extractOgImage(html), "https://example.com/d.jpg");
});

test("extractOgImage returns null when no image meta tag present", () => {
  const html = `<html><head><title>No image here</title></head></html>`;
  assert.equal(extractOgImage(html), null);
});

test("extractOgImage prefers og:image over twitter:image when both present", () => {
  const html = `<meta name="twitter:image" content="https://example.com/twitter.jpg"><meta property="og:image" content="https://example.com/og.jpg">`;
  assert.equal(extractOgImage(html), "https://example.com/og.jpg");
});
