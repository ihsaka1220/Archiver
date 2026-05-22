import { storage } from './lib/storage.js';
import { syncZhihu } from './lib/api/zhihu.js';
import { generateSummaryAndTags, testAiSettings } from './lib/ai.js';

const ALARM_SYNC = 'auto-sync';
const SYNC_INTERVAL_MINUTES = 60;
let activeSyncController = null;

void initializeBackground();
void recoverStaleSyncStatus();

// ── Alarm: periodic auto-sync ──────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_SYNC) {
    const settings = await storage.getSettings();
    if (settings.autoSync) await runSync(settings);
  }
});

async function setupAlarm() {
  await chrome.alarms.clear(ALARM_SYNC);
  const { autoSync, syncInterval } = await storage.getSettings();
  if (autoSync) {
    chrome.alarms.create(ALARM_SYNC, {
      periodInMinutes: syncInterval ?? SYNC_INTERVAL_MINUTES,
    });
  }
}

async function initializeBackground() {
  await storage.initDefaults();
  await setupAlarm();
}

// ── Message router ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch((err) => {
    console.error('[archiver] message error', err);
    sendResponse({ ok: false, error: err.message });
  });
  return true; // keep channel open for async response
});

async function handleMessage(msg) {
  switch (msg.type) {
    case 'SYNC_NOW': {
      await recoverStaleSyncStatus();
      return { ok: true, ...(await runSync(await storage.getSettings())) };
    }
    case 'GET_ITEMS': {
      const items = await storage.queryItems(msg.filter ?? {});
      return { ok: true, items };
    }
    case 'GET_SYNC_STATUS': {
      const syncStatus = await recoverStaleSyncStatus();
      return { ok: true, syncStatus };
    }
    case 'STOP_SYNC': {
      const syncStatus = await recoverStaleSyncStatus();
      if (!syncStatus.running) {
        return { ok: true, alreadyStopped: true };
      }

      if (!activeSyncController) {
        const recovered = await finalizeStoppedSync(syncStatus);
        return { ok: true, recovered: true, syncStatus: recovered };
      }

      activeSyncController.aborted = true;
      const nextProgress = {
        ...(syncStatus.progress ?? {}),
        updatedAt: Date.now(),
      };
      await storage.setSyncStatus({
        running: true,
        stopping: true,
        stopRequested: true,
        progress: nextProgress,
      });
      return { ok: true };
    }
    case 'GET_STATS': {
      const stats = await storage.getStats();
      return { ok: true, stats };
    }
    case 'DELETE_ITEM': {
      await storage.deleteItem(msg.id);
      return { ok: true };
    }
    case 'AI_PROCESS': {
      const item = await storage.getItem(msg.id);
      if (!item) return { ok: false, error: 'Item not found' };
      const settings = await storage.getSettings();
      const enriched = await generateSummaryAndTags(item, settings);
      await storage.upsertItem(enriched);
      return { ok: true, item: enriched };
    }
    case 'TEST_AI_SETTINGS': {
      return await testAiSettings({
        ...(await storage.getSettings()),
        ...(msg.settings ?? {}),
      });
    }
    case 'SETTINGS_CHANGED': {
      await setupAlarm();
      return { ok: true };
    }
    default:
      return { ok: false, error: `Unknown message type: ${msg.type}` };
  }
}

// ── Sync orchestration ─────────────────────────────────────────────────────
async function runSync(settings) {
  const currentStatus = await recoverStaleSyncStatus();
  if (currentStatus.running) {
    return {
      alreadyRunning: true,
      ...(currentStatus.lastResults ?? {}),
    };
  }

  const controller = { aborted: false };
  activeSyncController = controller;

  const results = {
    zhihu: null,
    ai: { enabled: Boolean(settings.aiEnabled && settings.aiApiKey), processed: 0, succeeded: 0, failed: 0 },
    errors: [],
  };
  const progress = {
    completed: 0,
    currentSource: '',
    lastTitle: '',
    aiProcessed: 0,
    aiSucceeded: 0,
    aiFailed: 0,
    updatedAt: Date.now(),
  };

  await storage.setSyncStatus({
    running: true,
    stopping: false,
    stopRequested: false,
    aborted: false,
    error: null,
    startedAt: Date.now(),
    progress,
  });

  try {
    if (settings.zhihuEnabled && !controller.aborted) {
      try {
        results.zhihu = await syncZhihu({
          onItem: (item) => persistSyncedItem(item, 'zhihu', settings, results, progress, controller),
          shouldStop: () => controller.aborted,
        });
      } catch (e) {
        results.errors.push({ source: 'zhihu', message: e.message });
      }
    }

    const aborted = controller.aborted;

    await storage.setSyncStatus({
      running: false,
      stopping: false,
      stopRequested: false,
      aborted,
      lastSync: Date.now(),
      progress: null,
      lastResults: { ...results, aborted },
    });

    if (!aborted && settings.notifications) {
      const total = results.zhihu?.newItems ?? 0;
      if (total > 0) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Archiver 同步完成',
          message: `新增 ${total} 条收藏`,
        });
      }
    }
  } catch (e) {
    await storage.setSyncStatus({
      running: false,
      stopping: false,
      stopRequested: false,
      error: e.message,
    });
    throw e;
  } finally {
    if (activeSyncController === controller) {
      activeSyncController = null;
    }
  }

  return { ...results, aborted: controller.aborted };
}

async function recoverStaleSyncStatus() {
  const syncStatus = await storage.getSyncStatus();
  if (!syncStatus.running || activeSyncController) {
    return syncStatus;
  }

  return await finalizeStoppedSync(syncStatus);
}

async function finalizeStoppedSync(syncStatus) {
  const next = {
    running: false,
    stopping: false,
    stopRequested: false,
    aborted: true,
    lastSync: Date.now(),
    progress: null,
    lastResults: {
      ...(syncStatus.lastResults ?? {}),
      aborted: true,
    },
    error: null,
  };

  await storage.setSyncStatus(next);
  return await storage.getSyncStatus();
}

async function persistSyncedItem(item, source, settings, results, progress, controller) {
  if (controller?.aborted) {
    return;
  }

  const baseItem = {
    ...item,
    source,
    createdAt: item.createdAt ?? Date.now(),
    tags: item.tags ?? [],
    summary: item.summary ?? '',
    category: item.category ?? '',
  };

  let savedItem = baseItem;
  if (!controller?.aborted && settings.aiEnabled && settings.aiApiKey) {
    savedItem = await generateSummaryAndTags(baseItem, settings);
    results.ai.processed++;
    if (savedItem.aiProcessed) {
      results.ai.succeeded++;
    } else {
      results.ai.failed++;
    }
  }

  if (controller?.aborted) {
    return;
  }

  await storage.upsertItem(savedItem);

  progress.completed++;
  progress.currentSource = source;
  progress.lastTitle = savedItem.title || '';
  progress.aiProcessed = results.ai.processed;
  progress.aiSucceeded = results.ai.succeeded;
  progress.aiFailed = results.ai.failed;
  progress.updatedAt = Date.now();

  await storage.setSyncStatus({ progress });
}

// ── Init ───────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(initializeBackground);
chrome.runtime.onStartup.addListener(initializeBackground);
