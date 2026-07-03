import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkScript, buildCues } from "../src/pipeline/05-generateSubtitles.js";

test("chunkScript splits into chunks of at most 5 words", () => {
  const script = "This is a fairly long script with many words in it for testing purposes today";
  const chunks = chunkScript(script);
  for (const chunk of chunks) {
    const wc = chunk.split(/\s+/).length;
    assert.ok(wc <= 5, `chunk "${chunk}" has ${wc} words`);
  }
});

test("chunkScript breaks earlier at punctuation once at least 2 words are buffered", () => {
  const chunks = chunkScript("Hello there, friend. This is fine.");
  assert.deepEqual(chunks, ["Hello there,", "friend. This is fine."]);
});

test("chunkScript preserves all words", () => {
  const script = "one two three four five six seven eight nine ten";
  const chunks = chunkScript(script);
  const rebuilt = chunks.join(" ").split(/\s+/);
  assert.deepEqual(rebuilt, script.split(" "));
});

test("buildCues distributes timing proportionally to word count", () => {
  const chunks = ["one two", "three four five six"];
  const cues = buildCues(chunks, 10, 0);
  assert.equal(cues.length, 2);
  // 2 words vs 4 words -> roughly 1/3 and 2/3 of duration
  const dur0 = cues[0].end - cues[0].start;
  const dur1 = cues[1].end - cues[1].start;
  assert.ok(Math.abs(dur0 / dur1 - 0.5) < 0.01);
});

test("buildCues leaves gaps between cues", () => {
  const chunks = ["one two", "three four"];
  const cues = buildCues(chunks, 10, 0.5);
  assert.equal(cues[1].start - cues[0].end, 0.5);
});

test("buildCues never produces negative durations", () => {
  const chunks = ["a", "b", "c", "d", "e", "f"];
  const cues = buildCues(chunks, 1, 0.05);
  for (const cue of cues) {
    assert.ok(cue.end >= cue.start);
  }
});
