import { exportItems } from '../lib/exporter/index.js';

// ── State ──────────────────────────────────────────────────────────────────
let allItems = [];
let activeSource = '';
let searchQuery = '';
let isSyncRunning = false;
let refreshTimer = null;
let statusHideTimer = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const btnSync = document.getElementById('btn-sync');
const btnStop = document.getElementById('btn-stop');
const syncStatus = document.getElementById('sync-status');
const itemsList = document.getElementById('items-list');
const searchInput = document.getElementById('search');
const exportFormat = document.getElementById('export-format');
const btnExport = document.getElementById('btn-export');
const VALID_EXPORT_FORMATS = new Set(['markdown', 'pdf', 'word']);

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  chrome.storage.onChanged.addListener(handleStorageChange);
  await loadSyncState();
  await loadStats();
  await loadItems();
  await restoreExportFormat();
}

// ── Stats ──────────────────────────────────────────────────────────────────
async function loadStats() {
  const { stats } = await msg({ type: 'GET_STATS' });
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-zhihu').textContent = stats.bySource?.zhihu ?? 0;
}

async function loadSyncState() {
  const { syncStatus } = await msg({ type: 'GET_SYNC_STATUS' });
  applySyncStatus(syncStatus ?? { running: false });
}

// ── Items ──────────────────────────────────────────────────────────────────
async function loadItems() {
  const filter = {};
  if (activeSource) filter.source = activeSource;
  if (searchQuery) filter.search = searchQuery;

  const { items } = await msg({ type: 'GET_ITEMS', filter });
  allItems = items;
  renderItems(items);
}

function renderItems(items) {
  if (!items.length) {
    itemsList.innerHTML = '<div class="empty-state">暂无收藏，点击「同步」开始</div>';
    return;
  }

  itemsList.innerHTML = items
    .map(
      (item) => `
    <div class="item-card" data-id="${item.id}" data-url="${item.url}">
      <div class="item-title">${esc(item.title)}</div>
      <div class="item-meta">
        <span class="source-badge ${item.source}">${sourceLabel(item.source)}</span>
        <span>${item.author ? esc(item.author) + ' · ' : ''}${formatDate(item.savedAt)}</span>
        ${item.category ? `<span>${esc(item.category)}</span>` : ''}
      </div>
      ${item.summary ? `<div class="item-summary">${esc(item.summary)}</div>` : ''}
      ${item.tags?.length ? `<div class="item-tags">${item.tags.map((t) => `<span class="tag-chip">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>
  `
    )
    .join('');
}

// ── Sync ───────────────────────────────────────────────────────────────────
btnSync.addEventListener('click', async () => {
  if (isSyncRunning) {
    showStatus('同步正在进行中…', 'info');
    return;
  }

  // Guard: at least one source must be enabled
  const saved = await chrome.storage.local.get('settings');
  const cfg = saved.settings ?? {};
  if (!cfg.zhihuEnabled) {
    showStatus('请先在设置中开启知乎数据源', 'error');
    return;
  }

  setSyncUiRunning(true);
  showStatus('正在同步…', 'info');

  try {
    const result = await msg({ type: 'SYNC_NOW' });

    if (result.alreadyRunning) {
      showStatus('同步正在后台继续执行…', 'info');
    } else if (result.aborted) {
      showStatus(buildStoppedStatus(result), 'info');
    } else if (result.errors?.length) {
      const detail = result.errors.map((e) => `${e.source}: ${e.message}`).join('；');
      showStatus(`同步出错：${detail}`, 'error');
    } else {
      showStatus(buildCompletedStatus(result), 'success');
    }

    await loadStats();
    await loadItems();
  } catch (e) {
    showStatus(`同步失败：${e.message}`, 'error');
  } finally {
    await loadSyncState();
  }
});

btnStop.addEventListener('click', async () => {
  if (!isSyncRunning || btnStop.disabled) return;

  btnStop.disabled = true;
  showStatus('正在停止，同步会在当前条目处理完成后结束…', 'info');

  try {
    await msg({ type: 'STOP_SYNC' });
  } catch (e) {
    btnStop.disabled = false;
    showStatus(`停止失败：${e.message}`, 'error');
  }
});

// ── Tabs ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', async () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    activeSource = tab.dataset.source;
    await loadItems();
  });
});

// ── Search ─────────────────────────────────────────────────────────────────
let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    searchQuery = searchInput.value.trim();
    await loadItems();
  }, 300);
});

// ── Open item on click ─────────────────────────────────────────────────────
itemsList.addEventListener('click', (e) => {
  const card = e.target.closest('.item-card');
  if (card?.dataset.url) chrome.tabs.create({ url: card.dataset.url });
});

// ── Export ─────────────────────────────────────────────────────────────────
exportFormat.addEventListener('change', async () => {
  await persistExportFormat(exportFormat.value);
});

btnExport.addEventListener('click', async () => {
  const format = exportFormat.value;
  const filter = {};
  if (activeSource) filter.source = activeSource;
  if (searchQuery) filter.search = searchQuery;

  const { items } = await msg({ type: 'GET_ITEMS', filter: { ...filter, limit: 1000 } });
  if (!items.length) {
    showStatus('没有可导出的内容', 'error');
    return;
  }

  await persistExportFormat(format);
  await exportItems(items, format, {
    filename: `archiver-${new Date().toISOString().slice(0, 10)}`,
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────
async function msg(payload) {
  const response = await chrome.runtime.sendMessage(payload);
  if (!response) {
    throw new Error('后台服务未响应，请先在 chrome://extensions 中重新加载扩展');
  }
  if (response.ok === false) {
    throw new Error(response.error || '操作失败');
  }
  return response;
}

function showStatus(text, type = 'info') {
  clearTimeout(statusHideTimer);
  syncStatus.textContent = text;
  syncStatus.className = `sync-status ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
  syncStatus.classList.remove('hidden');
  if (type !== 'info' && !isSyncRunning) {
    statusHideTimer = setTimeout(() => syncStatus.classList.add('hidden'), 6000);
  }
}

function formatAiStatus(ai) {
  if (!ai?.enabled) return '；AI 未开启';
  return `；AI 处理 ${ai.processed} 条，成功 ${ai.succeeded} 条，失败 ${ai.failed} 条`;
}

function applySyncStatus(syncState) {
  const running = Boolean(syncState?.running);
  setSyncUiRunning(running, Boolean(syncState?.stopping));

  if (running) {
    showStatus(formatRunningStatus(syncState), 'info');
    return;
  }

  if (syncState?.aborted || syncState?.lastResults?.aborted) {
    showStatus(buildStoppedStatus(syncState?.lastResults), 'info');
    return;
  }

  if (syncState?.error) {
    showStatus(`同步失败：${syncState.error}`, 'error');
    return;
  }

  const results = syncState?.lastResults;
  if (results?.errors?.length) {
    const detail = results.errors.map((e) => `${e.source}: ${e.message}`).join('；');
    showStatus(`同步出错：${detail}`, 'error');
    return;
  }

  if (results?.zhihu || results?.ai) {
    showStatus(buildCompletedStatus(results), 'success');
    return;
  }

  if (!syncState?.aborted) {
    syncStatus.classList.add('hidden');
  }
}

function setSyncUiRunning(running, stopping = false) {
  isSyncRunning = running;
  btnSync.disabled = running;
  btnSync.querySelector('svg').classList.toggle('spinning', running);
  btnStop.classList.toggle('hidden', !running);
  btnStop.disabled = !running || stopping;
  btnStop.textContent = stopping ? '停止中…' : '停止';
}

async function handleStorageChange(changes, areaName) {
  if (areaName !== 'local') return;

  if (changes.items && isSyncRunning) {
    scheduleLiveRefresh();
  }

  if (!changes.syncStatus) return;

  const next = changes.syncStatus.newValue ?? { running: false };
  const wasRunning = isSyncRunning;
  applySyncStatus(next);

  if (wasRunning && !next.running) {
    await loadStats();
    await loadItems();

    if (next.aborted || next.lastResults?.aborted) {
      showStatus(buildStoppedStatus(next.lastResults), 'info');
      return;
    }

    if (next.error) {
      showStatus(`同步失败：${next.error}`, 'error');
      return;
    }

    const results = next.lastResults ?? {};
    if (results.errors?.length) {
      const detail = results.errors.map((e) => `${e.source}: ${e.message}`).join('；');
      showStatus(`同步出错：${detail}`, 'error');
      return;
    }

    showStatus(buildCompletedStatus(results), 'success');
  }
}

function scheduleLiveRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    await loadStats();
    await loadItems();
  }, 150);
}

function formatRunningStatus(syncState) {
  const progress = syncState?.progress;
  if (!progress?.completed) {
    return syncState?.stopping ? '正在停止，等待当前条目处理完成…' : '正在同步…';
  }

  const parts = [`${syncState?.stopping ? '正在停止' : '正在同步'}，已完成 ${progress.completed} 条`];
  if (progress.currentSource) {
    parts.push(`来源：${sourceLabel(progress.currentSource)}`);
  }
  if (progress.aiProcessed) {
    parts.push(`AI 成功 ${progress.aiSucceeded}/${progress.aiProcessed}`);
  }
  if (progress.lastTitle) {
    parts.push(`最近：${truncate(progress.lastTitle, 18)}`);
  }
  return parts.join('，');
}

function buildStoppedStatus(results = {}) {
  const total = results.zhihu?.newItems ?? 0;
  const parts = [];
  if (results.zhihu) parts.push(`知乎 +${results.zhihu.newItems}`);
  const detail = parts.length ? `（${parts.join('，')}）` : '';
  return `同步已停止，已完成 ${total} 条${detail}${formatAiStatus(results.ai)}`;
}

function buildCompletedStatus(results = {}) {
  const total = results.zhihu?.newItems ?? 0;
  const zhihuText = formatZhihuSyncResult(results.zhihu);
  return `同步完成，新增 ${total} 条${zhihuText}${formatAiStatus(results.ai)}`;
}

function formatZhihuSyncResult(zhihu) {
  if (!zhihu) return '';

  const parts = [`知乎新增 ${zhihu.newItems ?? 0}`];
  if (zhihu.totalFetched) {
    parts.push(`抓取 ${zhihu.totalFetched}`);
  }
  if (zhihu.existingItems) {
    parts.push(`已存在 ${zhihu.existingItems}`);
  }
  if (zhihu.collections) {
    parts.push(`收藏夹 ${zhihu.collections}`);
  }
  return `（${parts.join('，')}）`;
}

async function restoreExportFormat() {
  const { settings } = await chrome.storage.local.get('settings');
  const format = settings?.exportFormat;
  if (VALID_EXPORT_FORMATS.has(format)) {
    exportFormat.value = format;
  }
}

async function persistExportFormat(format) {
  if (!VALID_EXPORT_FORMATS.has(format)) return;

  const { settings } = await chrome.storage.local.get('settings');
  if (settings?.exportFormat === format) return;

  await chrome.storage.local.set({
    settings: {
      ...(settings ?? {}),
      exportFormat: format,
    },
  });
}

function truncate(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function sourceLabel(s) {
  return s === 'zhihu' ? '知乎' : s;
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
