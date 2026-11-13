import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { linkTitle } from '../api/client';
import { cleanLink, siteName } from '../lib/reservations';
import { isBareLink, toEditorHtml } from '../lib/richtext';
import { Icon } from './Icon';

const SAFE_HREF = /^(https?:|mailto:)/i;

/** Titles are cached for the session so the same link is looked up once. */
const titleCache = new Map<string, Promise<string | null>>();
function lookupTitle(url: string): Promise<string | null> {
  let p = titleCache.get(url);
  if (!p) {
    p = linkTitle(url).catch(() => null);
    titleCache.set(url, p);
  }
  return p;
}

/** Hrefs of links whose visible text is the URL itself. */
function bareLinks(editor: Editor): string[] {
  const out = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (!node.isText || !node.text) return;
    const link = node.marks.find((m) => m.type.name === 'link');
    if (link && isBareLink(node.text, link.attrs.href)) out.add(link.attrs.href);
  });
  return [...out];
}

/** Replaces every bare occurrence of `href` with `title`, keeping the link. */
function replaceWithTitle(editor: Editor, href: string, title: string) {
  const ranges: { from: number; to: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const link = node.marks.find((m) => m.type.name === 'link' && m.attrs.href === href);
    if (link && isBareLink(node.text, href)) ranges.push({ from: pos, to: pos + node.nodeSize });
  });
  if (ranges.length === 0) return;
  const { tr, schema } = editor.state;
  for (const r of ranges.reverse()) {
    const marks = editor.state.doc.nodeAt(r.from)?.marks ?? [schema.marks.link.create({ href })];
    tr.replaceWith(r.from, r.to, schema.text(title, marks));
  }
  editor.view.dispatch(tr);
}

/**
 * Rich-text notes: bold, italic, bulleted and numbered lists, links.
 * Markdown-style shortcuts work (**bold**, *italic*, "- " and "1. " lists).
 * Pasted or typed URLs become links; when a link shows its raw URL, coo looks
 * up the page title and offers to show the title instead.
 */
export function RichNotes({
  id,
  value,
  onChange,
  label,
  placeholder = 'Add notes, links or a checklist…',
}: {
  id?: string;
  value: string;
  onChange: (html: string) => void;
  label: string;
  placeholder?: string;
}) {
  const [titles, setTitles] = useState<Record<string, string | null>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const requested = useRef(new Set<string>());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const timer = useRef<number>();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false, blockquote: false, code: false }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        protocols: ['http', 'https', 'mailto'],
        isAllowedUri: (url, ctx) => SAFE_HREF.test(url) && ctx.defaultValidate(url),
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: toEditorHtml(value),
    editorProps: {
      attributes: {
        class: 'rich-editor',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        ...(id ? { id } : {}),
      },
      // Cmd/Ctrl+click opens a link; a plain click places the cursor for editing.
      handleClick: (_view, _pos, event) => {
        const a = (event.target as HTMLElement).closest('a');
        if (a && (event.metaKey || event.ctrlKey) && SAFE_HREF.test(a.href)) {
          window.open(a.href, '_blank', 'noopener,noreferrer');
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChangeRef.current(ed.isEmpty ? '' : ed.getHTML());
      scheduleLookups(ed);
    },
  });

  const scheduleLookups = useCallback((ed: Editor) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      for (const href of bareLinks(ed)) {
        if (requested.current.has(href)) continue;
        requested.current.add(href);
        lookupTitle(href).then((t) => setTitles((cur) => ({ ...cur, [href]: t })));
      }
    }, 500);
  }, []);

  // Existing notes: offer titles for links that are already bare.
  useEffect(() => {
    if (editor) scheduleLookups(editor);
    return () => window.clearTimeout(timer.current);
  }, [editor, scheduleLookups]);

  if (!editor) return null;

  const inLink = editor.isActive('link');
  const href: string = inLink ? editor.getAttributes('link').href ?? '' : '';
  const suggestions = bareLinks(editor).filter((h) => titles[h] && !dismissed.has(h));

  const applyLink = () => {
    const url = cleanLink(linkDraft ?? '');
    const chain = editor.chain().focus().extendMarkRange('link');
    if (!url) {
      chain.unsetLink().run();
    } else if (editor.state.selection.empty && !inLink) {
      chain.insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run();
      scheduleLookups(editor);
    } else {
      chain.setLink({ href: url }).run();
    }
    setLinkDraft(null);
  };

  const tool = (name: string, icon: string, active: boolean, run: () => void) => (
    <button
      type="button"
      className={`tool ${active ? 'active' : ''}`}
      aria-label={name}
      title={name}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      <Icon name={icon} size={17} />
    </button>
  );

  return (
    <div className="rich">
      <div className="rich-toolbar" role="toolbar" aria-label="Formatting">
        {tool('Bold', 'bold', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run())}
        {tool('Italic', 'italic', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run())}
        {tool('Bulleted list', 'list', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run())}
        {tool('Numbered list', 'list-ordered', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run())}
        {tool(inLink ? 'Edit link' : 'Add link', 'link', inLink, () => setLinkDraft(inLink ? href : ''))}
      </div>

      {linkDraft !== null && (
        <div className="rich-linkbar">
          <input
            autoFocus
            aria-label="Link address"
            placeholder="Paste or type a link"
            value={linkDraft}
            inputMode="url"
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyLink();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setLinkDraft(null);
                editor.commands.focus();
              }
            }}
          />
          <button type="button" className="btn secondary small" onClick={applyLink}>
            {inLink ? 'Update' : 'Add'}
          </button>
          {inLink && (
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                editor.chain().focus().extendMarkRange('link').unsetLink().run();
                setLinkDraft(null);
              }}
            >
              Remove link
            </button>
          )}
          <button type="button" className="btn ghost small" onClick={() => setLinkDraft(null)}>
            Cancel
          </button>
        </div>
      )}

      <EditorContent editor={editor} />

      {inLink && linkDraft === null && SAFE_HREF.test(href) && (
        <div className="rich-linkinfo">
          <Icon name="link" size={15} />
          <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="link">
            Open {siteName(href)}
          </a>
          <Icon name="external" size={13} />
          <span className="muted small">or Cmd/Ctrl+click the link</span>
        </div>
      )}

      {suggestions.length > 0 && (
        <ul className="rich-suggestions" aria-live="polite">
          {suggestions.map((h) => (
            <li key={h}>
              <span className="small">
                Show <strong>{titles[h]}</strong> instead of <span className="muted">{h.length > 48 ? `${h.slice(0, 48)}…` : h}</span>?
              </span>
              <span className="rich-suggestion-actions">
                <button
                  type="button"
                  className="btn secondary small"
                  onClick={() => {
                    replaceWithTitle(editor, h, titles[h]!);
                    setDismissed((cur) => new Set(cur).add(h));
                    editor.commands.focus();
                  }}
                >
                  Use title
                </button>
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => {
                    setDismissed((cur) => new Set(cur).add(h));
                    editor.commands.focus();
                  }}
                >
                  Keep link
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
