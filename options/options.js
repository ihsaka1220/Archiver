const $ = (id) => document.getElementById(id);

let settings = {};

async function init() {
  const result = await chrome.storage.local.get('settings');
  settings = result.settings ?? {};

  $('zhihu-enabled').checked = settings.zhihuEnabled ?? false;
  $('auto-sync').checked = settings.autoSync ?? false;
  $('sync-interval').value = settings.syncInterval ?? 60;
  $('notifications').checked = settings.notifications ?? true;
  $('ai-enabled').checked = settings.aiEnabled ?? false;
  $('ai-provider').value = settings.aiProvider ?? 'openai';
  $('ai-base-url').value = settings.aiBaseUrl ?? '';
  $('ai-api-key').value = settings.aiApiKey ?? '';
  $('ai-model').value = settings.aiModel ?? '';

  toggleAiFields();
  toggleIntervalRow();
  renderCategories(settings.customCategories ?? ['技术', '设计', '商业', '生活', '其他']);
}

// ── Visibility toggles ─────────────────────────────────────────────────────
$('ai-enabled').addEventListener('change', toggleAiFields);
$('auto-sync').addEventListener('change', toggleIntervalRow);
$('btn-test-ai').addEventListener('click', testAiConfig);

function toggleAiFields() {
  $('ai-fields').classList.toggle('visible', $('ai-enabled').checked);
}
function toggleIntervalRow() {
  $('interval-row').classList.toggle('visible', $('auto-sync').checked);
}

// ── Categories ─────────────────────────────────────────────────────────────
let categories = [];

function renderCategories(cats) {
  categories = [...cats];
  const list = $('categories-list');
  list.innerHTML = categories
    .map(
      (c, i) => `
    <span class="cat-chip">
      ${esc(c)}
      <button data-index="${i}" title="删除">×</button>
    </span>`
    )
    .join('');

  list.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      categories.splice(Number(btn.dataset.index), 1);
      renderCategories(categories);
    });
  });
}

$('btn-add-category').addEventListener('click', () => {
  const input = $('new-category');
  const val = input.value.trim();
  if (!val || categories.includes(val)) return;
  categories.push(val);
  renderCategories(categories);
  input.value = '';
});

$('new-category').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-add-category').click();
});

// ── Save ───────────────────────────────────────────────────────────────────
$('btn-save').addEventListener('click', async () => {
  const updated = collectSettings();

  await chrome.storage.local.set({ settings: updated });
  settings = updated;

  // Notify background to reconfigure alarm
  chrome.runtime.sendMessage({ type: 'SETTINGS_CHANGED' });

  showToast();
});

async function testAiConfig() {
  const btn = $('btn-test-ai');
  btn.disabled = true;
  btn.textContent = '测试中…';
  showAiTestStatus('正在验证 AI 配置...', 'info');

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'TEST_AI_SETTINGS',
      settings: collectSettings(),
    });

    if (result.ok) {
      showAiTestStatus(
        `AI 配置可用\n服务商：${result.provider}\n模型：${result.model}\n测试摘要：${result.preview || '已成功返回结果'}`,
        'success'
      );
    } else {
      showAiTestStatus(
        `AI 配置失败\n服务商：${result.provider || $('ai-provider').value}\n模型：${result.model || $('ai-model').value || '未设置'}\n原因：${result.error || '未知错误'}`,
        'error'
      );
    }
  } catch (e) {
    showAiTestStatus(`AI 配置失败\n原因：${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '测试 AI 配置';
  }
}

// ── Clear data ─────────────────────────────────────────────────────────────
$('btn-clear').addEventListener('click', async () => {
  if (!confirm('确定要清除所有已同步的收藏数据吗？此操作不可撤销。')) return;
  await chrome.storage.local.remove(['items', 'syncStatus']);
  alert('数据已清除');
});

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast() {
  const t = $('save-toast');
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2000);
}

function showAiTestStatus(text, type) {
  const box = $('ai-test-status');
  box.textContent = text;
  box.className = `ai-test-status ${type === 'success' ? 'success' : type === 'error' ? 'error' : ''}`;
  box.classList.remove('hidden');
}

function collectSettings() {
  return {
    ...settings,
    zhihuEnabled: $('zhihu-enabled').checked,
    autoSync: $('auto-sync').checked,
    syncInterval: Number($('sync-interval').value) || 60,
    notifications: $('notifications').checked,
    aiEnabled: $('ai-enabled').checked,
    aiProvider: $('ai-provider').value,
    aiBaseUrl: $('ai-base-url').value.trim(),
    aiApiKey: $('ai-api-key').value.trim(),
    aiModel: $('ai-model').value.trim(),
    customCategories: categories,
  };
}

function esc(str) {
  return String(str ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

init();
