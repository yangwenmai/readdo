function hostMatchesDomain(host, domain) {
  const normalizedHost = String(host ?? "").toLowerCase();
  const normalizedDomain = String(domain ?? "").toLowerCase();
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

export function detectSourceType(url) {
  if (!url) return "other";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (hostMatchesDomain(host, "youtube.com") || hostMatchesDomain(host, "youtu.be")) return "youtube";
    if (hostMatchesDomain(host, "substack.com") || host.includes("newsletter")) return "newsletter";
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return "web";
    return "other";
  } catch {
    return "other";
  }
}

export function isSupportedCaptureUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeIntentText(intentText) {
  return String(intentText ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractApiErrorMessage(rawBody, statusCode) {
  const fallback = `Capture failed: ${statusCode}`;
  if (typeof rawBody !== "string") return fallback;
  const trimmed = rawBody.trim();
  if (!trimmed) return fallback;
  try {
    const parsed = JSON.parse(trimmed);
    const message = parsed?.error?.message;
    if (typeof message === "string" && message.trim()) {
      return `Capture failed: ${message.trim()}`;
    }
  } catch {
    // fallback to plain text body
  }
  return `Capture failed: ${trimmed.slice(0, 200)}`;
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
