// Generates a .docx-compatible HTML file that Word/WPS can open directly.
// No external library needed — Word accepts HTML with a special content-type.
import {
  escHtml,
  formatDate,
  getSourceLinkHtml,
  getSummaryDisplay,
  summaryToHtml,
  sourceLabel,
} from './common.js';

export function wordExport(items, { filename = 'archiver-export' } = {}) {
  const html = buildWordHtml(items);
  const blob = new Blob(['﻿' + html], {
    type: 'application/msword;charset=utf-8',
  });
  triggerDownload(blob, `${filename}.doc`);
}

function buildWordHtml(items) {
  const rows = items.map((item) => `
    <h2 style="color:#1a56db">${esc(item.title)}</h2>
    <p style="color:#6b7280;font-size:10pt">
      来源：${esc(sourceLabel(item.source))} &nbsp;|&nbsp;
      作者：${esc(item.author || '未知')} &nbsp;|&nbsp;
      时间：${formatDate(item.savedAt)}<br>
      原文：${getSourceLinkHtml(item, { showUrl: true })}
      ${item.category ? `&nbsp;|&nbsp; 分类：${esc(item.category)}` : ''}
      ${item.tags?.length ? `<br>标签：${item.tags.map(esc).join(' · ')}` : ''}
    </p>
    <p style="font-size:9.5pt;color:#6b7280;margin:4px 0 6px">${esc(getSummaryDisplay(item).label)}</p>
    <div class="summary-box">
      ${summaryToHtml(getSummaryDisplay(item).text, 'summary-paragraph')}
    </div>
    <hr>
  `).join('');

  return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:w="urn:schemas-microsoft-com:office:word"
    xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>Archiver 收藏导出</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
  body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; font-size: 11pt; }
  h1 { font-size: 18pt; }
  h2 { font-size: 13pt; margin-top: 18pt; }
  hr { border-top: 1px solid #ccc; }
  .summary-box { background:#f0f4ff; padding:8px; border-left:3px solid #6366f1; font-size:10.5pt; line-height:1.7; word-break:break-word; }
  .summary-paragraph { margin:0 0 10px; }
  .summary-paragraph:last-child { margin-bottom:0; }
</style>
</head>
<body>
<h1>Archiver 收藏导出</h1>
<p style="color:#6b7280">导出时间：${new Date().toLocaleString('zh-CN')} · 共 ${items.length} 条</p>
${rows}
</body></html>`;
}

function esc(str) {
  return escHtml(str);
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
