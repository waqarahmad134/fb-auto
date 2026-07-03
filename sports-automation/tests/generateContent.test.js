import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateContent,
  extractNameCandidates,
  personNamePostCheck,
  GENERIC_IMAGE_PROMPT
} from "../src/pipeline/content-validation.js";

function makeValidContent(overrides = {}) {
  return {
    script: Array(90).fill("word").join(" "),
    imagePrompt: "a footballer celebrating under stadium floodlights",
    title: "Big match update #Shorts",
    description: "Some description. #Football #Soccer",
    hashtags: ["#Football", "#Soccer"],
    ...overrides
  };
}

test("validateContent accepts a well-formed object", () => {
  assert.equal(validateContent(makeValidContent()), null);
});

test("validateContent rejects missing script", () => {
  const content = makeValidContent({ script: "" });
  assert.match(validateContent(content), /script/);
});

test("validateContent rejects script outside 60-140 words", () => {
  const tooShort = makeValidContent({ script: "too short" });
  assert.match(validateContent(tooShort), /word count/);

  const tooLong = makeValidContent({ script: Array(200).fill("word").join(" ") });
  assert.match(validateContent(tooLong), /word count/);
});

test("validateContent rejects title over 100 chars", () => {
  const content = makeValidContent({ title: "x".repeat(101) });
  assert.match(validateContent(content), /title/);
});

test("validateContent rejects missing hashtags", () => {
  const content = makeValidContent({ hashtags: [] });
  assert.match(validateContent(content), /hashtags/);
});

test("extractNameCandidates finds capitalized word pairs", () => {
  const names = extractNameCandidates("Lionel Messi scores stunning goal for Argentina");
  assert.ok(names.includes("Lionel Messi"));
});

test("extractNameCandidates returns empty for generic headlines", () => {
  const names = extractNameCandidates("team wins the match tonight");
  assert.deepEqual(names, []);
});

test("personNamePostCheck replaces imagePrompt when it contains a detected name", () => {
  const result = personNamePostCheck("Lionel Messi scores again", "Lionel Messi celebrating a goal");
  assert.equal(result, GENERIC_IMAGE_PROMPT);
});

test("personNamePostCheck leaves imagePrompt untouched when no name detected", () => {
  const prompt = "a footballer celebrating under floodlights";
  const result = personNamePostCheck("team wins the match tonight", prompt);
  assert.equal(result, prompt);
});
