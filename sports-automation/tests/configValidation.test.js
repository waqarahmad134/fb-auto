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
  delete env.MONGO_URI;
  assert.deepEqual(getMissingRequiredVars(env, true), ["MONGO_URI"]);
});

test("getMissingRequiredVars ignores missing publish-only vars in dry run", () => {
  const env = fullEnv();
  delete env.YT_CLIENT_ID;
  delete env.FB_PAGE_ACCESS_TOKEN;
  assert.deepEqual(getMissingRequiredVars(env, true), []);
});

test("getMissingRequiredVars requires publish vars when not in dry run", () => {
  const env = fullEnv();
  delete env.YT_CLIENT_ID;
  assert.deepEqual(getMissingRequiredVars(env, false), ["YT_CLIENT_ID"]);
});

test("getMissingRequiredVars returns everything on an empty env", () => {
  const missing = getMissingRequiredVars({}, false);
  assert.equal(missing.length, ALWAYS_REQUIRED.length + PUBLISH_REQUIRED.length);
});
