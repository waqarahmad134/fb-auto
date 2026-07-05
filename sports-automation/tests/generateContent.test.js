import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateContent,
  extractNameCandidates,
  findPersonLikeWords,
  personNamePostCheck,
  GENERIC_IMAGE_PROMPT
} from "../src/pipeline/content-validation.js";

function makeValidContent(overrides = {}) {
  return {
    script: Array(90).fill("word").join(" "),
    imagePrompt: "a footballer celebrating under stadium floodlights",
    posterHeadline: "Big Match Ends In Drama",
    posterSubtext: "Final score 3-1",
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

test("validateContent rejects missing posterHeadline", () => {
  const content = makeValidContent({ posterHeadline: "" });
  assert.match(validateContent(content), /posterHeadline/);
});

test("validateContent rejects posterHeadline over 70 chars", () => {
  const content = makeValidContent({ posterHeadline: "x".repeat(71) });
  assert.match(validateContent(content), /posterHeadline/);
});

test("validateContent rejects non-string posterSubtext", () => {
  const content = makeValidContent({ posterSubtext: undefined });
  assert.match(validateContent(content), /posterSubtext/);
});

test("validateContent accepts empty posterSubtext string", () => {
  const content = makeValidContent({ posterSubtext: "" });
  assert.equal(validateContent(content), null);
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

test("findPersonLikeWords catches a surname-only mention not present in the title", () => {
  const prompt = "a football pitch - close up on the field with a blurred silhouette of Ronaldo and a Norway flag, backlighting, cinematic composition, vertical framing.";
  assert.ok(findPersonLikeWords(prompt).includes("Ronaldo"));
});

test("findPersonLikeWords does not flag safe generic/place words", () => {
  const prompt = "a silhouette of a footballer celebrating in front of a Norway flag under stadium floodlights, cinematic vertical composition";
  assert.deepEqual(findPersonLikeWords(prompt), []);
});

test("findPersonLikeWords ignores the sentence-initial capitalized word", () => {
  const prompt = "Ronaldo celebrating a goal under floodlights";
  assert.deepEqual(findPersonLikeWords(prompt), []);
});

test("personNamePostCheck replaces imagePrompt for a surname not in the title (regression: hallucinated player name)", () => {
  const title = "Brazil vs Norway preview: 'No anti-Haaland plan', says Ancelotti";
  const prompt = "a football pitch - close up on the field with a blurred silhouette of Ronaldo and a Norway flag, backlighting, cinematic composition, vertical framing.";
  assert.equal(personNamePostCheck(title, prompt), GENERIC_IMAGE_PROMPT);
});
