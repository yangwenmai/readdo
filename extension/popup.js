const API_BASE = 'http://localhost:8080';
const WEB_APP_URL = 'http://localhost:5173';

// DOM elements
const captureView = document.getElementById('capture-view');
const successView = document.getElementById('success-view');
const pageTitle = document.getElementById('page-title');
const pageDomain = document.getElementById('page-domain');
const intentInput = document.getElementById('intent-input');
const saveBtn = document.getElementById('save-btn');
const saveText = document.getElementById('save-text');
const saveSpinner = document.getElementById('save-spinner');
const errorToast = document.getElementById('error-toast');
const errorMsg = document.getElementById('error-msg');
const retryBtn = document.getElementById('retry-btn');
const openInbox = document.getElementById('open-inbox');

// State
let currentTab = null;

// Initialize: get current tab info
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    currentTab = tabs[0];
    pageTitle.textContent = currentTab.title || 'Untitled';
    try {
      const url = new URL(currentTab.url);
      pageDomain.textContent = url.hostname;
    } catch {
      pageDomain.textContent = currentTab.url;
    }
  }
  intentInput.focus();
});

// Set inbox link
openInbox.href = WEB_APP_URL;

// Source type detection
function detectSourceType(url) {
  if (!url) return 'web';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('substack.com') || url.includes('newsletter')) return 'newsletter';
  return 'web';
}

// Extract domain from URL
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// Save handler
async function handleSave() {
  if (!currentTab) return;

  // Show loading state
  saveBtn.disabled = true;
  saveText.textContent = 'Saving...';
  saveSpinner.classList.remove('hidden');
  errorToast.classList.add('hidden');

  const payload = {
    url: currentTab.url,
    title: currentTab.title || '',
    domain: extractDomain(currentTab.url),
    source_type: detectSourceType(currentTab.url),
    intent_text: intentInput.value.trim(),
  };

  try {
    const resp = await fetch(`${API_BASE}/api/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${resp.status}`);
    }

    // Success: switch to success view
    captureView.classList.add('hidden');
    successView.classList.remove('hidden');
  } catch (err) {
    // Show error
    saveBtn.disabled = false;
    saveText.textContent = '💾 Save';
    saveSpinner.classList.add('hidden');
    errorMsg.textContent = err.message || 'Save failed';
    errorToast.classList.remove('hidden');
  }
}

saveBtn.addEventListener('click', handleSave);
retryBtn.addEventListener('click', handleSave);

// Allow Enter to save (Shift+Enter for newline)
intentInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSave();
  }
});
