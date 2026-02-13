import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeUrlForCapture, detectSourceType, stableCaptureKey } from "../capture-utils.js";

test("detectSourceType identifies known source types", () => {
  assert.equal(detectSourceType("https://www.youtube.com/watch?v=abc"), "youtube");
  assert.equal(detectSourceType("https://foo.substack.com/p/hello"), "newsletter");
  assert.equal(detectSourceType("https://example.com/read"), "web");
  assert.equal(detectSourceType("file:///tmp/a.txt"), "other");
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
