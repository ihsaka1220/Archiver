import { storage } from '../storage.js';
import { findOrOpenTab, execInTab } from '../tab-runner.js';

export async function syncZhihu({ onItem, shouldStop } = {}) {
  const { tabId, opened } = await findOrOpenTab('www.zhihu.com');
  const persistItem = onItem ?? ((item) => storage.upsertItem(item));
  const isStopped = () => Boolean(shouldStop?.());
  let newItems = 0;
  let totalFetched = 0;
  let collectionCount = 0;
  let existingItems = 0;

  try {
    if (isStopped()) {
      return { newItems, totalFetched, collections: collectionCount, aborted: true };
    }

    const uid = await execInTab(tabId, fetchMe);
    if (!uid) throw new Error('未登录知乎，请先在浏览器中登录');

    const collections = await execInTab(tabId, fetchCollections, [uid]);
    collectionCount = collections?.length ?? 0;
    if (!collections?.length) {
      return { newItems: 0, totalFetched: 0, collections: 0, existingItems: 0 };
    }

    for (const col of collections) {
      if (isStopped()) {
        return { newItems, totalFetched, collections: collectionCount, aborted: true };
      }

      let offset = 0;
      const limit = 20;

      while (true) {
        if (isStopped()) {
          return { newItems, totalFetched, collections: collectionCount, aborted: true };
        }

        const page = await execInTab(tabId, fetchCollectionPage, [col.id, col.title, offset, limit]);
        if (!page) break;
        if (page.error) throw new Error(page.error);

        totalFetched += page.items.length;

        for (const item of page.items) {
          if (isStopped()) {
            return { newItems, totalFetched, collections: collectionCount, aborted: true };
          }

          const existing = await storage.getItem(item.id);
          if (!existing) {
            await persistItem(item);
            newItems++;
          } else {
            existingItems++;
          }
        }

        if (page.isEnd || page.items.length < limit) break;
        offset += limit;
        if (isStopped()) {
          return { newItems, totalFetched, collections: collectionCount, aborted: true };
        }
        await sleep(300);
      }
    }

    return { newItems, totalFetched, collections: collectionCount, existingItems, aborted: false };
  } finally {
    if (opened) chrome.tabs.remove(tabId).catch(() => {});
  }
}

// ── Self-contained tab functions (no imports, no closures) ─────────────────

async function fetchMe() {
  try {
    const r = await fetch('https://www.zhihu.com/api/v4/me?include=id', {
      credentials: 'include',
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.id ?? null;
  } catch {
    return null;
  }
}

async function fetchCollections(uid) {
  function formatErrorDetail(text) {
    if (!text) return '';
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact ? `：${compact.slice(0, 120)}` : '';
  }

  try {
    const r = await fetch(
      `https://www.zhihu.com/api/v4/people/${uid}/collections?offset=0&limit=20`,
      { credentials: 'include' }
    );
    if (!r.ok) {
      throw new Error(`获取收藏夹失败（HTTP ${r.status}）${formatErrorDetail(await r.text())}`);
    }
    const d = await r.json();
    return (d.data ?? []).map((c) => ({ id: c.id, title: c.title }));
  } catch (e) {
    throw new Error(`获取收藏夹失败：${e.message}`);
  }
}

async function fetchCollectionPage(collectionId, collectionTitle, offset, limit) {
  function normalizeEntryType(type, content) {
    if (content.question?.id) return 'answer';
    return type;
  }

  function buildEntryUrl(type, content) {
    const qid = content.question?.id;
    if (qid) return `https://www.zhihu.com/question/${qid}/answer/${content.id}`;
    if (type === 'answer') {
      return `https://www.zhihu.com/answer/${content.id}`;
    }
    if (type === 'zvideo') return `https://www.zhihu.com/zvideo/${content.id}`;
    return `https://zhuanlan.zhihu.com/p/${content.id}`;
  }

  function formatErrorDetail(text) {
    if (!text) return '';
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact ? `：${compact.slice(0, 120)}` : '';
  }

  function stripHtml(html) {
    return String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return stripHtml(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    if (Array.isArray(value)) {
      return value.map(normalizeText).filter(Boolean).join('\n').trim();
    }

    if (typeof value === 'object') {
      const candidates = [
        value.content,
        value.text,
        value.excerpt,
        value.title,
        value.description,
        value.reason,
        value.value,
        value.html,
      ];
      for (const candidate of candidates) {
        const normalized = normalizeText(candidate);
        if (normalized) return normalized;
      }
      return '';
    }

    return '';
  }

  try {
    const r = await fetch(
      `https://www.zhihu.com/api/v4/collections/${collectionId}/items?offset=${offset}&limit=${limit}`,
      { credentials: 'include' }
    );
    if (!r.ok) {
      throw new Error(
        `读取收藏夹「${collectionTitle || collectionId}」失败（HTTP ${r.status}）${formatErrorDetail(await r.text())}`
      );
    }
    const d = await r.json();
    const batch = d.data ?? [];

    const items = batch.map((entry) => {
      const content = entry.content;
      if (!content) return null;
      const type = normalizeEntryType(entry.type, content);
      const id = `zhihu_${type}_${content.id}`;
      return {
        id,
        source: 'zhihu',
        type,
        title: content.question?.title ?? content.title ?? '无标题',
        url: buildEntryUrl(type, content),
        questionId: content.question?.id ?? '',
        author: content.author?.name ?? '',
        content: normalizeText(content.content ?? content.excerpt),
        description: normalizeText(content.excerpt),
        coverImage: content.thumbnail ?? '',
        savedAt: (entry.updated_time ?? 0) * 1000,
        collectionTitle,
        tags: [],
        summary: '',
        category: '',
      };
    }).filter(Boolean);

    return { items, isEnd: d.paging?.is_end ?? true };
  } catch (e) {
    return { error: e.message };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
