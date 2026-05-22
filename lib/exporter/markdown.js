import {
  formatDate,
  getSourceLinkMarkdown,
  getSummaryDisplay,
  summaryToMarkdownLines,
  sourceLabel,
} from './common.js';

export function markdownExport(items, { filename = 'archiver-export' } = {}) {
  const lines = [
    '# Archiver 收藏导出',
    `> 导出时间：${new Date().toLocaleString('zh-CN')}  `,
    `> 共 ${items.length} 条`,
    '',
  ];

  for (const item of items) {
    lines.push(`## ${item.title}`);
    lines.push('');

    const meta = [
      `- **来源**：${sourceLabel(item.source)}`,
      `- **作者**：${item.author || '未知'}`,
      `- **链接**：${getSourceLinkMarkdown(item)}`,
      `- **收藏时间**：${formatDate(item.savedAt)}`,
    ];
    if (item.category) meta.push(`- **分类**：${item.category}`);
    if (item.tags?.length) meta.push(`- **标签**：${item.tags.join(' · ')}`);
    lines.push(...meta, '');

    const summary = getSummaryDisplay(item);
    lines.push(`### ${summary.label}`, '');
    lines.push(...summaryToMarkdownLines(summary.text), '');

    lines.push('---', '');
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  triggerDownload(blob, `${filename}.md`);
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
