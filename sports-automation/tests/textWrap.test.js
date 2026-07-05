import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapText, truncateToMaxLines } from "../src/utils/textWrap.js";

test("wrapText returns single line when text fits", () => {
  assert.equal(wrapText("short headline", 30), "short headline");
});

test("wrapText breaks at word boundaries once over the limit", () => {
  const result = wrapText("Manchester United Stun Liverpool In Derby", 20);
  const lines = result.split("\n");
  for (const line of lines) {
    assert.ok(line.length <= 20 || !line.includes(" "), `line "${line}" exceeds limit and has room to break`);
  }
  assert.equal(lines.join(" "), "Manchester United Stun Liverpool In Derby");
});

test("wrapText never drops words", () => {
  const input = "one two three four five six seven eight";
  const result = wrapText(input, 10);
  assert.equal(result.replace(/\n/g, " "), input);
});

test("wrapText keeps a single very long word on its own line rather than looping forever", () => {
  const result = wrapText("Supercalifragilisticexpialidocious", 10);
  assert.equal(result, "Supercalifragilisticexpialidocious");
});

test("wrapText handles empty string", () => {
  assert.equal(wrapText("", 20), "");
});

test("truncateToMaxLines leaves text unchanged when within the line limit", () => {
  assert.equal(truncateToMaxLines("one\ntwo", 2), "one\ntwo");
});

test("truncateToMaxLines cuts to maxLines and adds an ellipsis to the last kept line (regression: 3-line headline overlapping subtext)", () => {
  const wrapped = wrapText("'Sassuolo and Bologna in Bowie transfer talks", 18);
  assert.equal(wrapped.split("\n").length, 3, "test fixture should actually wrap to 3 lines");
  const result = truncateToMaxLines(wrapped, 2);
  const lines = result.split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith("…"));
});

test("truncateToMaxLines strips trailing punctuation before adding the ellipsis", () => {
  const result = truncateToMaxLines("one\ntwo,\nthree", 2);
  assert.equal(result, "one\ntwo…");
});
