import { test } from "node:test";
import assert from "node:assert/strict";
import { getMissingRequiredVars, ALWAYS_REQUIRED, PUBLISH_REQUIRED } from "../src/config-validation.js";

function fullEnv() {
  const env = {};
  for (const key of [...ALWAYS_REQUIRED, ...PUBLISH_REQUIRED]) env[key] = "value";
  return env;
}

test("getMissingRequiredVars returns empty when all vars present (dryRun=false)", () => {
  assert.deepEqual(getMissingRequiredVars(fullEnv(), false), []);
});

test("getMissingRequiredVars flags missing always-required vars even in dry run", () => {
  const env = fullEnv();
  delete env.RSS_FEEDS;
  assert.deepEqual(getMissingRequiredVars(env, true), ["RSS_FEEDS"]);
});

test("getMissingRequiredVars flags missing always-required vars when not in dry run", () => {
  const env = fullEnv();
  delete env.OLLAMA_BASE_URL;
  assert.deepEqual(getMissingRequiredVars(env, false), ["OLLAMA_BASE_URL"]);
});

test("getMissingRequiredVars returns everything on an empty env", () => {
  const missing = getMissingRequiredVars({}, false);
  assert.equal(missing.length, ALWAYS_REQUIRED.length + PUBLISH_REQUIRED.length);
});
