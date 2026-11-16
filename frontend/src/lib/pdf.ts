/** Renders the first page of a PDF to a PNG data URL (pdf.js is loaded lazily). */
import type { FileRef } from '../types/coo';
import { fetchBlob } from './files';

const cache = new Map<string, Promise<string | null>>();

async function render(file: FileRef, width: number): Promise<string | null> {
  const blob = await fetchBlob(file);
  if (!blob) return null;
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return canvas.toDataURL('image/png');
  } finally {
    void task.destroy();
  }
}

export function pdfFirstPage(file: FileRef, width = 1200): Promise<string | null> {
  const key = `${file.key}@${width}`;
  let p = cache.get(key);
  if (!p) {
    p = render(file, width).catch(() => null);
    cache.set(key, p);
    p.then((r) => r === null && cache.delete(key));
  }
  return p;
}
