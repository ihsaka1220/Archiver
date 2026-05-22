/**
 * Opens a dedicated background tab on the given domain.
 * Using a dedicated tab avoids interrupting sync when the user navigates away
 * from an existing site tab during collection.
 * Returns the tab id once the page is ready.
 */
export async function findOrOpenTab(domain) {
  const tab = await chrome.tabs.create({
    url: `https://${domain}`,
    active: false,
  });

  await waitForTabComplete(tab.id);

  return { tabId: tab.id, opened: true };
}

export async function navigateTab(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await waitForTabComplete(tabId);
}

/**
 * Runs a self-contained async function inside a tab and returns its result.
 * The function must not reference any external variables or imports.
 */
export async function execInTab(tabId, fn, args = [], options = {}) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: fn,
    args,
    world: options.world ?? 'ISOLATED',
  });
  const result = results[0]?.result;
  if (result?.error) throw new Error(result.error);
  return result;
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, 15000);

    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}
