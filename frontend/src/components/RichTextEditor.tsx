import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

interface Props {
  value: string;
  onChange: (html: string) => void;
}

/** Minimal TipTap rich-text editor. Stores/returns HTML. */
export default function RichTextEditor({ value, onChange }: Props) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value || '',
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // When the selected item changes, push the new value into the editor.
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || '', false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  if (!editor) return null;

  const btn = (label: React.ReactNode, active: boolean, onClick: () => void) => (
    <button
      type="button"
      className={active ? 'rte-btn active' : 'rte-btn'}
      onMouseDown={(e) => e.preventDefault()} // keep selection
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="rte">
      <div className="rte-toolbar">
        {btn(<strong>B</strong>, editor.isActive('bold'), () =>
          editor.chain().focus().toggleBold().run(),
        )}
        {btn(<em>I</em>, editor.isActive('italic'), () =>
          editor.chain().focus().toggleItalic().run(),
        )}
        {btn('H2', editor.isActive('heading', { level: 2 }), () =>
          editor.chain().focus().toggleHeading({ level: 2 }).run(),
        )}
        {btn('• List', editor.isActive('bulletList'), () =>
          editor.chain().focus().toggleBulletList().run(),
        )}
        {btn('1. List', editor.isActive('orderedList'), () =>
          editor.chain().focus().toggleOrderedList().run(),
        )}
      </div>
      <EditorContent editor={editor} className="rte-content" />
    </div>
  );
}
