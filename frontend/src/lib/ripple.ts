/**
 * Global Material-style ripple. Any element with the `ripple` class gets an
 * ink ripple on pointer-down. Installed once (from the app shell); returns a
 * cleanup fn. Elements need `position: relative; overflow: hidden` (see CSS).
 */
export function installRipple(): () => void {
  function onPointerDown(e: PointerEvent) {
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('.ripple');
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ink = document.createElement('span');
    ink.className = 'ripple-ink';
    ink.style.width = ink.style.height = `${size}px`;
    ink.style.left = `${e.clientX - rect.left - size / 2}px`;
    ink.style.top = `${e.clientY - rect.top - size / 2}px`;
    ink.addEventListener('animationend', () => ink.remove());
    target.appendChild(ink);
  }

  document.addEventListener('pointerdown', onPointerDown);
  return () => document.removeEventListener('pointerdown', onPointerDown);
}
