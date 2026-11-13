import { lazy, Suspense, type ComponentProps } from 'react';

// The editor (Tiptap/ProseMirror) roughly doubles the bundle, so it is loaded
// only when a task dialog opens.
const RichNotes = lazy(() => import('./RichNotes').then((m) => ({ default: m.RichNotes })));

export function RichNotesLazy(props: ComponentProps<typeof RichNotes>) {
  return (
    <Suspense fallback={<div className="rich rich-loading" aria-busy="true" />}>
      <RichNotes {...props} />
    </Suspense>
  );
}
