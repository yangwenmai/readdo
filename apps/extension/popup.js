const intentEl = document.getElementById("intent");
const resultEl = document.getElementById("result");
const captureBtn = document.getElementById("captureBtn");

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
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
      source_type: "web",
      intent_text: intentText,
    };

    const response = await fetch("http://localhost:8787/api/capture", {
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

    resultEl.textContent = "Captured. You can close this tab.";
  } catch (err) {
    resultEl.textContent = `Capture failed: ${String(err)}`;
  }
});
