const intentEl = document.getElementById("intent");
const resultEl = document.getElementById("result");
const captureBtn = document.getElementById("captureBtn");
const openInboxBtn = document.getElementById("openInboxBtn");

const API_BASE = "http://localhost:8787/api";
const INBOX_URL = "http://localhost:5173";

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function detectSourceType(url) {
  if (!url) return "other";
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("substack.com") || lower.includes("newsletter")) return "newsletter";
  if (lower.startsWith("http")) return "web";
  return "other";
}

function canonicalizeUrlForCapture(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const trackingKeys = new Set(["fbclid", "gclid", "mc_eid", "mkt_tok"]);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (key.startsWith("utm_") || trackingKeys.has(key)) {
        parsed.searchParams.delete(key);
      }
    }
    const sortedEntries = Array.from(parsed.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    parsed.search = "";
    for (const [key, value] of sortedEntries) {
      parsed.searchParams.append(key, value);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

async function stableCaptureKey(url, intentText) {
  const input = new TextEncoder().encode(`${url}\n${intentText}`);
  const digest = await crypto.subtle.digest("SHA-256", input);
  const bytes = Array.from(new Uint8Array(digest)).slice(0, 16);
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `extcap_${hex}`;
}

captureBtn?.addEventListener("click", async () => {
  const tab = await currentTab();
  const intentText = (intentEl?.value ?? "").trim();

  if (!tab?.url || !intentText) {
    resultEl.textContent = "Intent and URL are required.";
    return;
  }

  try {
    const canonicalUrl = canonicalizeUrlForCapture(tab.url);
    const idempotencyKey = await stableCaptureKey(canonicalUrl, intentText);
    const payload = {
      capture_id: idempotencyKey,
      url: tab.url,
      title: tab.title ?? "",
      domain: new URL(tab.url).hostname,
      source_type: detectSourceType(tab.url),
      intent_text: intentText,
    };

    const response = await fetch(API_BASE + "/capture", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    const responsePayload = await response.json().catch(() => null);
    if (!response.ok) {
      resultEl.textContent = `Capture failed: ${response.status}`;
      return;
    }

    if (responsePayload?.idempotent_replay === true) {
      resultEl.textContent = "Already captured for this URL + intent. Open Inbox to continue.";
      return;
    }
    resultEl.textContent = "Captured. Open Inbox to continue.";
  } catch (err) {
    resultEl.textContent = `Capture failed: ${String(err)}`;
  }
});

openInboxBtn?.addEventListener("click", async () => {
  await chrome.tabs.create({ url: INBOX_URL });
});
