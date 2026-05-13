// marked.js is loaded as a UMD global (window.marked) before this module runs

export function renderMarkdown(text) {
  if (!text) return '';
  if (typeof marked === 'undefined') return escapeHtml(text);

  marked.setOptions({ breaks: true, gfm: true, pedantic: false });

  const html = marked.parse(text);
  return sanitize(html);
}

function sanitize(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=/gi, 'data-blocked=')
    .replace(/href\s*=\s*["']javascript:[^"']*/gi, 'href="about:blank"');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function extractTitle(content) {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim().slice(0, 80);
  const first = content.split('\n').find(l => l.trim());
  return first ? first.replace(/^#+\s*/, '').trim().slice(0, 80) : 'Untitled';
}

export function extractTags(content) {
  // Match #word that is NOT at the start of a line (those are headings)
  const matches = content.match(/(?<!^|\n)#([a-zA-Z][a-zA-Z0-9_-]*)/g) || [];
  return [...new Set(matches.map(t => t.slice(1).toLowerCase()))];
}

export function renderCheckboxes(html) {
  // Convert GFM task list items to interactive checkboxes
  return html
    .replace(/<li>\[ \]/g, '<li class="task-item"><input type="checkbox" disabled>')
    .replace(/<li>\[x\]/gi, '<li class="task-item task-done"><input type="checkbox" checked disabled>');
}
