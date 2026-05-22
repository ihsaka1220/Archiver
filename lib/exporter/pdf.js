import {
  escHtml,
  formatDate,
  getSourceLinkHtml,
  getSourceUrl,
  getSummaryDisplay,
  summaryToHtml,
  sourceLabel,
} from './common.js';

export function pdfExport(items, { filename = 'archiver-export' } = {}) {
  const html = buildHtml(items);
  const win = window.open('', '_blank');
  if (!win) {
    alert('请允许弹出窗口以导出 PDF');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.close();
  }, 500);
}

function buildHtml(items) {
  const rows = items.map((item) => `
    <div class="item">
      <h2>${renderTitle(item)}</h2>
      <div class="meta">
        ${esc(sourceLabel(item.source))} · ${esc(item.author || '未知')} · ${formatDate(item.savedAt)}
        ${item.category ? ` · <span class="cat">${esc(item.category)}</span>` : ''}
        ${item.tags?.length ? ` · ${item.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}` : ''}
      </div>
      <div class="source-link">原文：${getSourceLinkHtml(item, { showUrl: true })}</div>
      <div class="summary-label">${esc(getSummaryDisplay(item).label)}</div>
      <div class="summary">${summaryToHtml(getSummaryDisplay(item).text, 'summary-paragraph')}</div>
    </div>
  `).join('<hr>');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Archiver 收藏导出</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 800px; margin: 0 auto; padding: 24px; color: #222; }
  h1 { font-size: 1.6rem; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; }
  h2 { font-size: 1.1rem; margin: 0 0 6px; }
  h2 a { color: #1a56db; text-decoration: none; }
  .meta { font-size: 0.8rem; color: #6b7280; margin-bottom: 8px; }
  .source-link { font-size: 0.8rem; margin-bottom: 8px; word-break: break-all; }
  .source-link a { color: #1a56db; text-decoration: none; }
  .summary-label { font-size: 0.78rem; color: #6b7280; margin-bottom: 4px; }
  .cat { background: #dbeafe; color: #1e40af; padding: 1px 6px; border-radius: 4px; }
  .tag { background: #f3f4f6; color: #374151; padding: 1px 6px; border-radius: 4px; }
  .summary { background: #f9fafb; border-left: 3px solid #6366f1; padding: 8px 12px; margin: 8px 0; font-size: 0.9rem; line-height: 1.7; }
  .summary-paragraph { margin: 0 0 10px; }
  .summary-paragraph:last-child { margin-bottom: 0; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<h1>Archiver 收藏导出</h1>
<p style="color:#6b7280;font-size:0.85rem">导出时间：${new Date().toLocaleString('zh-CN')} · 共 ${items.length} 条</p>
${rows}
</body></html>`;
}

function renderTitle(item) {
  const title = esc(item.title);
  const url = getSourceUrl(item);
  return url ? `<a href="${escHtml(url)}">${title}</a>` : title;
}

function esc(str) {
  return escHtml(str);
}
