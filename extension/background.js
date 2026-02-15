// Register context menu on install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'readdo-capture-link',
    title: 'Save to Read→Do',
    contexts: ['link'],
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'readdo-capture-link') return;

  // Store the link info for the popup to consume
  await chrome.storage.session.set({
    pendingCapture: {
      url: info.linkUrl,
      title: info.selectionText || '',
      referrer_url: tab?.url || '',
      referrer_title: tab?.title || '',
    },
  });

  // Open a mini popup window for intent input
  chrome.windows.create({
    url: 'popup.html?mode=link',
    type: 'popup',
    width: 420,
    height: 340,
    focused: true,
  });
});
