export function detectSourceType(url) {
  if (!url) return "other";
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("substack.com") || lower.includes("newsletter")) return "newsletter";
  if (lower.startsWith("http")) return "web";
  return "other";
}

export function isSupportedCaptureUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "data:";
  } catch {
    return false;
  }
}

export function normalizeIntentText(intentText) {
  return String(intentText ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeUrlForCapture(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if ((parsed.protocol === "https:" && parsed.port === "443") || (parsed.protocol === "http:" && parsed.port === "80")) {
      parsed.port = "";
    }
    const trackingKeys = new Set(["fbclid", "gclid", "mc_eid", "mkt_tok"]);
    for (const key of Array.from(parsed.searchParams.keys())) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey.startsWith("utm_") || trackingKeys.has(normalizedKey)) {
        parsed.searchParams.delete(key);
      }
    }
    const sortedEntries = Array.from(parsed.searchParams.entries()).sort(([aKey, aValue], [bKey, bValue]) => {
      const keyCmp = aKey.localeCompare(bKey);
      if (keyCmp !== 0) return keyCmp;
      return aValue.localeCompare(bValue);
    });
    parsed.search = "";
    for (const [key, value] of sortedEntries) {
      parsed.searchParams.append(key, value);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export async function stableCaptureKey(url, intentText) {
  const normalizedIntent = normalizeIntentText(intentText);
  const input = new TextEncoder().encode(`${url}\n${normalizedIntent}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  const bytes = Array.from(new Uint8Array(digest)).slice(0, 16);
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `extcap_${hex}`;
}
