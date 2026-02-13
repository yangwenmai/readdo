import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveCaptureKey,
  normalizeCaptureIdempotencyKey,
  normalizeIdempotencyHeaderKey,
  normalizeIdempotencyKey,
  normalizeIntentForCaptureKey,
} from "../src/idempotency.js";

test("normalizeIntentForCaptureKey collapses whitespace", () => {
  assert.equal(normalizeIntentForCaptureKey("  keep   this \n focused\t\tplease  "), "keep this focused please");
});

test("deriveCaptureKey is deterministic and extcap-prefixed", () => {
  const keyA = deriveCaptureKey("https://example.com/article?a=1", "read later");
  const keyB = deriveCaptureKey("https://example.com/article?a=1", "read later");
  const keyC = deriveCaptureKey("https://example.com/article?a=1", "different intent");

  assert.equal(keyA, keyB);
  assert.notEqual(keyA, keyC);
  assert.match(keyA, /^extcap_[0-9a-f]{32}$/u);
});

test("normalizeIdempotencyKey handles scalars and arrays", () => {
  assert.equal(normalizeIdempotencyKey(undefined), "");
  assert.equal(normalizeIdempotencyKey(null), "");
  assert.equal(normalizeIdempotencyKey("  abc  "), "abc");
  assert.equal(normalizeIdempotencyKey(["", "  ", "k1", "k2"]), "k1");
  assert.equal(normalizeIdempotencyKey([null, undefined, "  "]), "");
});

test("normalizeIdempotencyHeaderKey handles comma-separated and arrays", () => {
  assert.equal(normalizeIdempotencyHeaderKey(undefined), "");
  assert.equal(normalizeIdempotencyHeaderKey(" , , first,second "), "first");
  assert.equal(normalizeIdempotencyHeaderKey([" , ", " , second ", "third"]), "second");
  assert.equal(normalizeIdempotencyHeaderKey([null, undefined, "   "]), "");
});

test("normalizeCaptureIdempotencyKey lowercases extcap digest only", () => {
  assert.equal(
    normalizeCaptureIdempotencyKey("EXTCAP_AABBCCDDEEFF00112233445566778899"),
    "extcap_aabbccddeeff00112233445566778899",
  );
  assert.equal(
    normalizeCaptureIdempotencyKey("  EXTCAP_AABBCCDDEEFF00112233445566778899", true),
    "extcap_aabbccddeeff00112233445566778899",
  );
  assert.equal(normalizeCaptureIdempotencyKey("custom_key"), "custom_key");
});
