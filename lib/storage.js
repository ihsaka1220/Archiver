// Thin wrapper around chrome.storage.local with typed helpers

const KEYS = {
  ITEMS: 'items',
  SETTINGS: 'settings',
  SYNC_STATUS: 'syncStatus',
};

const UNSET = Symbol('unset');
const cache = {
  items: UNSET,
  settings: UNSET,
  syncStatus: UNSET,
};

const DEFAULT_SETTINGS = {
  zhihuEnabled: false,
  autoSync: false,
  syncInterval: 60,
  notifications: true,
  aiEnabled: false,
  aiProvider: 'openai', // 'openai' | 'anthropic'
  aiApiKey: '',
  aiModel: 'gpt-4o-mini',
  customCategories: ['技术', '设计', '商业', '生活', '其他'],
  exportFormat: 'markdown',
};

async function get(key) {
  const result = await chrome.storage.local.get(key);
  return result[key];
}

async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes[KEYS.ITEMS]) {
    cache.items = changes[KEYS.ITEMS].newValue ?? {};
  }
  if (changes[KEYS.SETTINGS]) {
    cache.settings = changes[KEYS.SETTINGS].newValue ?? {};
  }
  if (changes[KEYS.SYNC_STATUS]) {
    cache.syncStatus = changes[KEYS.SYNC_STATUS].newValue ?? { running: false };
  }
});

async function getCachedValue(cacheKey, storageKey, fallback) {
  if (cache[cacheKey] !== UNSET) {
    return cache[cacheKey];
  }

  const value = (await get(storageKey)) ?? fallback;
  cache[cacheKey] = value;
  return value;
}

async function getItemsMap() {
  return await getCachedValue('items', KEYS.ITEMS, {});
}

async function getSavedSettings() {
  return await getCachedValue('settings', KEYS.SETTINGS, {});
}

async function getSavedSyncStatus() {
  return await getCachedValue('syncStatus', KEYS.SYNC_STATUS, { running: false });
}

function sanitizeSettings(settings) {
  const { aiCustomPrompt: _removedPrompt, ...rest } = settings ?? {};
  return rest;
}

function removeItemsBySource(items, source) {
  const nextItems = {};
  let changed = false;

  for (const [id, item] of Object.entries(items ?? {})) {
    if (item?.source === source) {
      changed = true;
      continue;
    }
    nextItems[id] = item;
  }

  return { items: nextItems, changed };
}

async function migrateLegacyItems() {
  const currentItems = await get(KEYS.ITEMS);
  if (!currentItems) return;

  const { items: cleanedItems, changed } = removeItemsBySource(currentItems, 'xiaohongshu');
  if (!changed) return;

  cache.items = cleanedItems;
  await set(KEYS.ITEMS, cleanedItems);
}

async function getAllItemsList() {
  return Object.values(await getItemsMap());
}

export const storage = {
  // ── Settings ──────────────────────────────────────────────────────────────
  async getSettings() {
    const saved = sanitizeSettings(await getSavedSettings());
    return { ...DEFAULT_SETTINGS, ...saved };
  },

  async saveSettings(partial) {
    const current = await this.getSettings();
    const next = sanitizeSettings({ ...current, ...partial });
    cache.settings = next;
    await set(KEYS.SETTINGS, next);
  },

  async initDefaults() {
    const existing = await get(KEYS.SETTINGS);
    if (!existing) {
      cache.settings = { ...DEFAULT_SETTINGS };
      await set(KEYS.SETTINGS, cache.settings);
    } else {
      const sanitized = sanitizeSettings(existing);
      cache.settings = sanitized;
      if (Object.keys(sanitized).length !== Object.keys(existing).length) {
        await set(KEYS.SETTINGS, sanitized);
      }
    }

    const items = await get(KEYS.ITEMS);
    if (!items) {
      cache.items = {};
      await set(KEYS.ITEMS, cache.items);
    }

    await migrateLegacyItems();
  },

  // ── Items ─────────────────────────────────────────────────────────────────
  async getAllItems() {
    return { ...(await getItemsMap()) };
  },

  async getItem(id) {
    const items = await getItemsMap();
    return items[id] ? { ...items[id] } : null;
  },

  async upsertItem(item) {
    const items = await getItemsMap();
    const nextItems = {
      ...items,
      [item.id]: { ...items[item.id], ...item, updatedAt: Date.now() },
    };
    cache.items = nextItems;
    await set(KEYS.ITEMS, nextItems);
  },

  async deleteItem(id) {
    const items = await getItemsMap();
    if (!items[id]) return;

    const nextItems = { ...items };
    delete nextItems[id];
    cache.items = nextItems;
    await set(KEYS.ITEMS, nextItems);
  },

  async queryItems({ source, tag, category, search, limit = 200, offset = 0 } = {}) {
    let filtered = await getAllItemsList();

    if (source) filtered = filtered.filter((i) => i.source === source);
    if (tag) filtered = filtered.filter((i) => i.tags?.includes(tag));
    if (category) filtered = filtered.filter((i) => i.category === category);
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (i) =>
          i.title?.toLowerCase().includes(q) ||
          i.summary?.toLowerCase().includes(q) ||
          i.content?.toLowerCase().includes(q)
      );
    }

    filtered.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
    return filtered.slice(offset, offset + limit);
  },

  async getStats() {
    const all = await getAllItemsList();
    const bySource = {};
    const byCategory = {};
    const allTags = {};

    for (const item of all) {
      bySource[item.source] = (bySource[item.source] ?? 0) + 1;
      if (item.category) byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
      for (const tag of item.tags ?? []) {
        allTags[tag] = (allTags[tag] ?? 0) + 1;
      }
    }

    return { total: all.length, bySource, byCategory, topTags: allTags };
  },

  // ── Sync status ───────────────────────────────────────────────────────────
  async getSyncStatus() {
    return { ...(await getSavedSyncStatus()) };
  },

  async setSyncStatus(partial) {
    const current = await getSavedSyncStatus();
    const next = { ...current, ...partial };
    cache.syncStatus = next;
    await set(KEYS.SYNC_STATUS, next);
  },
};
