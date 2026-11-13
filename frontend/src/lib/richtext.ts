/**
 * Task notes are rich text: HTML produced by the editor (bold, italic, lists,
 * links). Notes written before rich text existed, and notes added through MCP,
 * are plain text. These helpers bridge the two. Notes are only ever rendered
 * through the editor's schema (never injected as raw HTML), so anything outside
 * that schema is dropped on load.
 */

const HTML_START = /^\s*<(p|ul|ol|li|h[1-6]|blockquote|div|br)[\s>/]/i;
const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

export function isRichHtml(s: string): boolean {
  return HTML_START.test(s);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Plain text → editor HTML: one paragraph per line, URLs become links. */
export function plainToHtml(s: string): string {
  if (!s.trim()) return '';
  return s
    .split(/\r?\n/)
    .map((line) => {
      let out = '';
      let last = 0;
      for (const m of line.matchAll(URL_RE)) {
        out += escapeHtml(line.slice(last, m.index));
        const url = escapeHtml(m[0]);
        out += `<a href="${url}">${url}</a>`;
        last = (m.index ?? 0) + m[0].length;
      }
      out += escapeHtml(line.slice(last));
      return `<p>${out}</p>`;
    })
    .join('');
}

export function toEditorHtml(notes: string): string {
  return isRichHtml(notes) ? notes : plainToHtml(notes);
}

/** Readable one-line text for meta lines and search. */
export function notesText(notes: string): string {
  if (!notes) return '';
  if (!isRichHtml(notes)) return notes;
  const doc = new DOMParser().parseFromString(notes, 'text/html');
  const blocks = [...doc.body.querySelectorAll('p, li')].map((el) => el.textContent?.trim() ?? '').filter(Boolean);
  return (blocks.length ? blocks.join(' · ') : doc.body.textContent ?? '').trim();
}

/** A link whose visible text is just its own URL (worth replacing with a title). */
export function isBareLink(text: string, href: string): boolean {
  const norm = (u: string) => u.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();
  return norm(text) === norm(href);
}
