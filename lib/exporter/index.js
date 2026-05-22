import { markdownExport } from './markdown.js';
import { pdfExport } from './pdf.js';
import { wordExport } from './word.js';

export async function exportItems(items, format, options = {}) {
  switch (format) {
    case 'markdown': return markdownExport(items, options);
    case 'pdf':      return pdfExport(items, options);
    case 'word':     return wordExport(items, options);
    default:         throw new Error(`Unknown export format: ${format}`);
  }
}
