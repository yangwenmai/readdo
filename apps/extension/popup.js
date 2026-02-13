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

captureBtn?.addEventListener("click", async () => {
  const tab = await currentTab();
  const intentText = (intentEl?.value ?? "").trim();

  if (!tab?.url || !intentText) {
    resultEl.textContent = "Intent and URL are required.";
    return;
  }

  try {
    const payload = {
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
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      resultEl.textContent = `Capture failed: ${response.status}`;
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
