import test from "node:test";
import assert from "node:assert/strict";
import { parseCliOptions } from "../src/index.js";

test("parseCliOptions returns defaults", () => {
  const opts = parseCliOptions([]);
  assert.equal(opts.cases, "docs/evals/cases/*.json");
  assert.equal(opts.out, "docs/evals/reports/latest.json");
  assert.equal(opts.format, "text");
  assert.equal(opts.failOn, "P1");
  assert.equal(opts.profile, "engineer");
});

test("parseCliOptions accepts valid custom flags", () => {
  const opts = parseCliOptions([
    "--cases",
    "docs/evals/cases/case_001.json",
    "--out",
    "docs/evals/reports/custom.json",
    "--format",
    "json",
    "--fail-on",
    "P0",
    "--profile",
    "creator",
  ]);
  assert.equal(opts.cases, "docs/evals/cases/case_001.json");
  assert.equal(opts.out, "docs/evals/reports/custom.json");
  assert.equal(opts.format, "json");
  assert.equal(opts.failOn, "P0");
  assert.equal(opts.profile, "creator");
});

test("parseCliOptions falls back on invalid enum values", () => {
  const opts = parseCliOptions([
    "--format",
    "xml",
    "--fail-on",
    "P9",
    "--profile",
    "unknown",
  ]);
  assert.equal(opts.format, "text");
  assert.equal(opts.failOn, "P1");
  assert.equal(opts.profile, "engineer");
});
