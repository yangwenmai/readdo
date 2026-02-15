const API_BASE = 'http://localhost:8080';
const WEB_APP_URL = 'http://localhost:5173';

// DOM elements
const captureView = document.getElementById('capture-view');
const successView = document.getElementById('success-view');
const pageTitle = document.getElementById('page-title');
const pageDomain = document.getElementById('page-domain');
const referrerInfo = document.getElementById('referrer-info');
const referrerTitle = document.getElementById('referrer-title');
const intentInput = document.getElementById('intent-input');
const saveBtn = document.getElementById('save-btn');
const saveText = document.getElementById('save-text');
const saveSpinner = document.getElementById('save-spinner');
const errorToast = document.getElementById('error-toast');
const errorMsg = document.getElementById('error-msg');
const retryBtn = document.getElementById('retry-btn');
const openInbox = document.getElementById('open-inbox');
const successSubtitle = document.getElementById('success-subtitle');

// State
let captureData = null;
let isLinkMode = false;

// Detect mode from URL params
const params = new URLSearchParams(window.location.search);
isLinkMode = params.get('mode') === 'link';

// Initialize based on mode
if (isLinkMode) {
  initLinkMode();
} else {
  initTabMode();
}

// Mode: capture a link from context menu
async function initLinkMode() {
  const result = await chrome.storage.session.get('pendingCapture');
  const pending = result.pendingCapture;

  if (!pending) {
    pageTitle.textContent = 'No link data found';
    saveBtn.disabled = true;
    return;
  }

  captureData = {
    url: pending.url,
    title: pending.title || '',
    referrer_url: pending.referrer_url || '',
    referrer_title: pending.referrer_title || '',
  };

  // Display link info
  pageTitle.textContent = captureData.title || captureData.url;
  try {
    pageDomain.textContent = new URL(captureData.url).hostname;
  } catch {
    pageDomain.textContent = captureData.url;
  }

  // Show referrer info if available
  if (referrerInfo && captureData.referrer_title) {
    referrerTitle.textContent = captureData.referrer_title;
    referrerInfo.classList.remove('hidden');
  }

  // Clean up storage
  await chrome.storage.session.remove('pendingCapture');

  intentInput.focus();
}

// Mode: capture current active tab (original behavior)
function initTabMode() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      const tab = tabs[0];
      captureData = {
        url: tab.url,
        title: tab.title || '',
      };
      pageTitle.textContent = tab.title || 'Untitled';
      try {
        const url = new URL(tab.url);
        pageDomain.textContent = url.hostname;
      } catch {
        pageDomain.textContent = tab.url;
      }
    }
    intentInput.focus();
  });
}

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
  if (!captureData) return;

  // Show loading state
  saveBtn.disabled = true;
  saveText.textContent = 'Saving...';
  saveSpinner.classList.remove('hidden');
  errorToast.classList.add('hidden');

  const payload = {
    url: captureData.url,
    title: captureData.title || '',
    domain: extractDomain(captureData.url),
    source_type: detectSourceType(captureData.url),
    intent_text: intentInput.value.trim(),
  };

  // Include referrer info in link mode
  if (isLinkMode && captureData.referrer_url) {
    payload.referrer_url = captureData.referrer_url;
    payload.referrer_title = captureData.referrer_title || '';
  }

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

    // In link mode: update subtitle and auto-close after delay
    if (isLinkMode) {
      successSubtitle.textContent = 'Link captured from the page.';
      setTimeout(() => window.close(), 1500);
    }
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
