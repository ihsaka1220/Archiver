export function sourceLabel(source) {
  return source === 'zhihu' ? '知乎' : source;
}

export function formatDate(ts) {
  return ts ? new Date(ts).toLocaleString('zh-CN') : '未知';
}

export function excerpt(item, maxLength = 120) {
  const text = String(item.description || item.content || '').trim();
  return text.slice(0, maxLength).trim();
}

export function getSummaryText(item, fallback = '暂无摘要') {
  const summary = String(item.summary || '').trim();
  if (summary) return summary;

  const extracted = excerpt(item);
  return extracted || fallback;
}

export function getSummaryDisplay(item) {
  const summary = String(item.summary || '').trim();
  if (summary) {
    return { label: 'AI摘要', text: summary, mode: 'ai' };
  }

  const extracted = excerpt(item);
  if (extracted) {
    return { label: '内容摘录', text: extracted, mode: 'excerpt' };
  }

  return { label: 'AI摘要', text: '暂无摘要', mode: 'empty' };
}

export function summaryToMarkdownLines(text) {
  const paragraphs = splitParagraphs(text);
  if (!paragraphs.length) return ['暂无摘要'];

  return paragraphs.flatMap((paragraph, index) =>
    index === paragraphs.length - 1 ? [paragraph] : [paragraph, '']
  );
}

export function summaryToHtml(text, paragraphClass = '') {
  const classAttr = paragraphClass ? ` class="${escAttr(paragraphClass)}"` : '';
  const paragraphs = splitParagraphs(text);
  if (!paragraphs.length) return `<p${classAttr}>暂无摘要</p>`;

  return paragraphs
    .map((paragraph) => `<p${classAttr}>${escHtml(paragraph)}</p>`)
    .join('');
}

export function getSourceUrl(item) {
  const normalized = normalizeHttpUrl(item.url);

  if (item.source === 'zhihu') {
    const fallback = buildZhihuUrl(item);
    if (shouldPreferZhihuFallback(normalized, fallback)) return fallback;
    if (normalized) return normalized;
    if (fallback) return fallback;
  }

  if (normalized) return normalized;
  return '';
}

export function getSourceLinkMarkdown(item, label = '查看原文') {
  const url = getSourceUrl(item);
  return url ? `[${label}](${url})` : '原文链接缺失';
}

export function getSourceLinkHtml(item, { label = '查看原文', showUrl = false } = {}) {
  const url = getSourceUrl(item);
  if (!url) return '<span style="color:#9ca3af">原文链接缺失</span>';

  const text = showUrl ? escHtml(url) : escHtml(label);
  return `<a href="${escAttr(url)}">${text}</a>`;
}

export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return escHtml(str).replace(/'/g, '&#39;');
}

function splitParagraphs(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((part) => part.replace(/\n+/g, ' ').trim())
    .filter(Boolean);
}

function normalizeHttpUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const withProtocol = raw.startsWith('//') ? `https:${raw}` : raw;

  try {
    const url = new URL(withProtocol);
    return /^https?:$/.test(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function buildZhihuUrl(item) {
  const type = item.type || extractZhihuType(item.id);
  const contentId = extractZhihuContentId(item.id);
  const questionId = String(item.questionId ?? '').trim();
  if (!contentId) return '';

  if (questionId) {
    return `https://www.zhihu.com/question/${questionId}/answer/${contentId}`;
  }

  if (type === 'answer') return `https://www.zhihu.com/answer/${contentId}`;
  if (type === 'zvideo') return `https://www.zhihu.com/zvideo/${contentId}`;
  return `https://zhuanlan.zhihu.com/p/${contentId}`;
}

function shouldPreferZhihuFallback(normalized, fallback) {
  if (!fallback) return false;
  if (!normalized) return true;

  const fallbackIsAnswer = fallback.includes('/answer/') || fallback.includes('/question/');
  const normalizedIsArticle = normalized.includes('zhuanlan.zhihu.com/p/');
  return fallbackIsAnswer && normalizedIsArticle;
}

function extractZhihuType(id) {
  const match = String(id ?? '').match(/^zhihu_([^_]+)_.+$/);
  return match?.[1] ?? '';
}

function extractZhihuContentId(id) {
  const match = String(id ?? '').match(/^zhihu_[^_]+_(.+)$/);
  return match?.[1] ?? '';
}
