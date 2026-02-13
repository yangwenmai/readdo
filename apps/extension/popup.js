import {
  canonicalizeUrlForCapture,
  detectSourceType,
  extractApiErrorMessage,
  isSupportedCaptureUrl,
  normalizeIntentText,
  stableCaptureKey,
} from "./capture-utils.js";

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

captureBtn?.addEventListener("click", async () => {
  const tab = await currentTab();
  const intentText = normalizeIntentText(intentEl?.value ?? "");

  if (!tab?.url || !intentText) {
    resultEl.textContent = "Intent and URL are required.";
    return;
  }
  if (!isSupportedCaptureUrl(tab.url)) {
    resultEl.textContent = "Unsupported page URL. Please capture from an http/https page.";
    return;
  }

  try {
    const canonicalUrl = canonicalizeUrlForCapture(tab.url);
    const idempotencyKey = await stableCaptureKey(canonicalUrl, intentText);
    const canonicalParsedUrl = new URL(canonicalUrl);
    const payload = {
      capture_id: idempotencyKey,
      url: canonicalUrl,
      title: tab.title ?? "",
      domain: canonicalParsedUrl.hostname,
      source_type: detectSourceType(canonicalUrl),
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

    const raw = await response.text();
    let responsePayload = null;
    if (raw) {
      try {
        responsePayload = JSON.parse(raw);
      } catch {
        responsePayload = null;
      }
    }
    if (!response.ok) {
      resultEl.textContent = extractApiErrorMessage(raw, response.status);
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
