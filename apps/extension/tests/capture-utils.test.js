import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeUrlForCapture,
  detectSourceType,
  extractApiErrorMessage,
  isSupportedCaptureUrl,
  normalizeIntentText,
  stableCaptureKey,
} from "../capture-utils.js";

test("detectSourceType identifies known source types", () => {
  assert.equal(detectSourceType("https://www.youtube.com/watch?v=abc"), "youtube");
  assert.equal(detectSourceType("https://foo.substack.com/p/hello"), "newsletter");
  assert.equal(detectSourceType("https://example.com/read"), "web");
  assert.equal(detectSourceType("https://example.com/newsletter"), "web");
  assert.equal(detectSourceType("file:///tmp/a.txt"), "other");
});

test("isSupportedCaptureUrl validates capture-safe protocols", () => {
  assert.equal(isSupportedCaptureUrl("https://example.com/read"), true);
  assert.equal(isSupportedCaptureUrl("http://example.com/read"), true);
  assert.equal(isSupportedCaptureUrl("data:text/plain,hello"), false);
  assert.equal(isSupportedCaptureUrl("file:///tmp/a.txt"), false);
  assert.equal(isSupportedCaptureUrl("chrome://extensions"), false);
  assert.equal(isSupportedCaptureUrl("not a valid url"), false);
});

test("canonicalizeUrlForCapture strips tracking params and hash", () => {
  const canonical = canonicalizeUrlForCapture("https://example.com/path?b=2&utm_source=x&a=1#section");
  assert.equal(canonical, "https://example.com/path?a=1&b=2");
});

test("canonicalizeUrlForCapture removes default ports", () => {
  const httpsCanonical = canonicalizeUrlForCapture("HTTPS://Example.com:443/path?b=2&a=1");
  const httpCanonical = canonicalizeUrlForCapture("http://example.com:80/path?z=9");
  assert.equal(httpsCanonical, "https://example.com/path?a=1&b=2");
  assert.equal(httpCanonical, "http://example.com/path?z=9");
});

test("canonicalizeUrlForCapture strips tracking params case-insensitively", () => {
  const canonical = canonicalizeUrlForCapture("https://example.com/path?A=1&UTM_SOURCE=x&FbClId=foo&b=2");
  assert.equal(canonical, "https://example.com/path?A=1&b=2");
});

test("canonicalizeUrlForCapture keeps unknown params sorted", () => {
  const canonical = canonicalizeUrlForCapture("https://example.com/path?z=9&k=3");
  assert.equal(canonical, "https://example.com/path?k=3&z=9");
});

test("canonicalizeUrlForCapture sorts repeated keys by value for stability", () => {
  const canonicalA = canonicalizeUrlForCapture("https://example.com/path?tag=b&tag=a&x=1");
  const canonicalB = canonicalizeUrlForCapture("https://example.com/path?tag=a&x=1&tag=b");
  assert.equal(canonicalA, "https://example.com/path?tag=a&tag=b&x=1");
  assert.equal(canonicalB, "https://example.com/path?tag=a&tag=b&x=1");
});

test("canonicalizeUrlForCapture returns input for invalid URL", () => {
  assert.equal(canonicalizeUrlForCapture("not a valid url"), "not a valid url");
});

test("normalizeIntentText trims and collapses spaces", () => {
  assert.equal(normalizeIntentText("  keep   this focused  "), "keep this focused");
  assert.equal(normalizeIntentText(""), "");
  assert.equal(normalizeIntentText(null), "");
});

test("extractApiErrorMessage prefers JSON error.message", () => {
  const raw = JSON.stringify({ error: { message: "Idempotency-Key mismatch" } });
  assert.equal(extractApiErrorMessage(raw, 400), "Capture failed: Idempotency-Key mismatch");
});

test("extractApiErrorMessage falls back to plain text body", () => {
  assert.equal(extractApiErrorMessage("gateway timeout", 504), "Capture failed: gateway timeout");
});

test("extractApiErrorMessage falls back to status code when body empty", () => {
  assert.equal(extractApiErrorMessage("", 500), "Capture failed: 500");
});

test("extractApiErrorMessage truncates long plain text responses", () => {
  const longBody = "x".repeat(500);
  const message = extractApiErrorMessage(longBody, 500);
  assert.equal(message.length, "Capture failed: ".length + 200);
  assert.match(message, /^Capture failed: x+$/);
});

test("stableCaptureKey is deterministic for same input", async () => {
  const a = await stableCaptureKey("https://example.com/path", "keep this");
  const b = await stableCaptureKey("https://example.com/path", "keep this");
  const c = await stableCaptureKey("https://example.com/path", "different intent");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^extcap_[0-9a-f]{32}$/);
});

test("stableCaptureKey normalizes whitespace in intent text", async () => {
  const a = await stableCaptureKey("https://example.com/path", "keep   this");
  const b = await stableCaptureKey("https://example.com/path", "  keep this  ");
  assert.equal(a, b);
});

test("stableCaptureKey matches explicit and implicit default ports after canonicalization", async () => {
  const canonicalA = canonicalizeUrlForCapture("https://example.com:443/path?a=1");
  const canonicalB = canonicalizeUrlForCapture("https://example.com/path?a=1");
  const keyA = await stableCaptureKey(canonicalA, "same intent");
  const keyB = await stableCaptureKey(canonicalB, "same intent");
  assert.equal(keyA, keyB);
});
