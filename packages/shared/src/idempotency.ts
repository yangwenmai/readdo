import { createHash } from "node:crypto";

export function normalizeIntentForCaptureKey(intentText: string): string {
  return intentText.replace(/\s+/g, " ").trim();
}

export function deriveCaptureKey(url: string, intentText: string): string {
  const normalizedIntent = normalizeIntentForCaptureKey(intentText);
  const digest = createHash("sha256")
    .update(`${url}\n${normalizedIntent}`)
    .digest("hex")
    .slice(0, 32);
  return `extcap_${digest}`;
}

export function normalizeIdempotencyKey(rawValue: unknown): string {
  if (Array.isArray(rawValue)) {
    for (const entry of rawValue) {
      const normalizedEntry = entry == null ? "" : String(entry).trim();
      if (normalizedEntry) return normalizedEntry;
    }
    return "";
  }
  return rawValue == null ? "" : String(rawValue).trim();
}

export function normalizeIdempotencyHeaderKey(rawValue: unknown): string {
  if (Array.isArray(rawValue)) {
    for (const entry of rawValue) {
      if (entry == null) continue;
      const segments = String(entry)
        .split(",")
        .map((segment) => segment.trim())
        .filter(Boolean);
      if (segments[0]) return segments[0];
    }
    return "";
  }
  return String(rawValue ?? "")
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)[0] ?? "";
}

export function normalizeCaptureIdempotencyKey(rawValue: unknown, fromHeader = false): string {
  const key = fromHeader ? normalizeIdempotencyHeaderKey(rawValue) : normalizeIdempotencyKey(rawValue);
  if (!key) return "";
  const extcapMatch = /^extcap_([0-9a-f]{32})$/iu.exec(key);
  if (!extcapMatch) return key;
  const digest = extcapMatch.at(1);
  if (!digest) return key;
  return `extcap_${digest.toLowerCase()}`;
}
