/** Presigned file URL cache (batched), downloads and generated SVG summaries. */
import { useEffect, useState } from 'react';
import { fileUrls } from '../api/client';
import type { FileRef } from '../types/coo';

const TTL = 50 * 60 * 1000; // presigned GETs live 60 min
const cache = new Map<string, { url: string; at: number }>();
const pending = new Map<string, ((url: string | null) => void)[]>();
let flushTimer: number | null = null;

function flush() {
  flushTimer = null;
  const keys = [...pending.keys()];
  const waiters = new Map(pending);
  pending.clear();
  fileUrls(keys)
    .then((urls) => {
      for (const k of keys) {
        const url = urls[k] ?? null;
        if (url) cache.set(k, { url, at: Date.now() });
        waiters.get(k)?.forEach((fn) => fn(url));
      }
    })
    .catch(() => keys.forEach((k) => waiters.get(k)?.forEach((fn) => fn(null))));
}

export function getFileUrl(key: string): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    const list = pending.get(key) ?? [];
    list.push(resolve);
    pending.set(key, list);
    if (flushTimer === null) flushTimer = window.setTimeout(flush, 10);
  });
}

export function useFileUrl(file: FileRef | null | undefined): string | null {
  const key = file?.key ?? null;
  const [url, setUrl] = useState<string | null>(() => {
    const hit = key ? cache.get(key) : undefined;
    return hit && Date.now() - hit.at < TTL ? hit.url : null;
  });
  useEffect(() => {
    let live = true;
    if (!key) {
      setUrl(null);
      return;
    }
    getFileUrl(key).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [key]);
  return url;
}

export async function fetchBlob(file: FileRef): Promise<Blob | null> {
  const url = await getFileUrl(file.key);
  if (!url) return null;
  const res = await fetch(url);
  return res.ok ? res.blob() : null;
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadOriginal(file: FileRef) {
  const blob = await fetchBlob(file);
  if (blob) saveBlob(blob, file.name);
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function safeFilename(s: string) {
  return s.replace(/[^\w\s.-]+/g, '').trim().replace(/\s+/g, '-') || 'document';
}

/**
 * A single SVG card with the document's details and (for IDs) the front and
 * back images embedded as data URLs.
 */
export async function summarySvg(p: {
  title: string;
  typeLabel: string;
  rows: [string, string][];
  images: FileRef[];
}): Promise<Blob> {
  const W = 720;
  const pad = 36;
  let y = pad + 20;
  const parts: string[] = [];
  parts.push(`<text x="${pad}" y="${y}" font-size="13" fill="#6B7075">${esc(p.typeLabel)}</text>`);
  y += 34;
  parts.push(`<text x="${pad}" y="${y}" font-size="24" font-weight="600" fill="#1E2226">${esc(p.title)}</text>`);
  y += 24;
  for (const f of p.images) {
    const blob = await fetchBlob(f);
    if (!blob) continue;
    const data = await blobToDataUrl(blob);
    const h = Math.round((W - pad * 2) / 1.586);
    parts.push(
      `<rect x="${pad}" y="${y}" width="${W - pad * 2}" height="${h}" rx="14" fill="#F6F5F2"/>` +
        `<image href="${data}" x="${pad}" y="${y}" width="${W - pad * 2}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`,
    );
    y += h + 16;
  }
  y += 10;
  for (const [k, v] of p.rows) {
    if (!v) continue;
    parts.push(`<text x="${pad}" y="${y}" font-size="12.5" fill="#6B7075">${esc(k)}</text>`);
    y += 26;
    parts.push(`<text x="${pad}" y="${y}" font-size="20" fill="#1E2226">${esc(v)}</text>`);
    y += 22;
  }
  y += pad;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}" font-family="Inter, system-ui, sans-serif"><rect width="100%" height="100%" fill="#FFFFFF"/>${parts.join('')}</svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}
