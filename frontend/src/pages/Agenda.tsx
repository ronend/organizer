import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ISODate, Task } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Empty, PageHead, Segmented, SectionHead } from '../components/ui';
import { TaskRow } from '../components/TaskRow';
import { Icon } from '../components/Icon';
import { AddTaskDialog } from '../dialogs/TaskDialogs';
import {
  BUCKETS,
  BUCKET_LABEL,
  allSubjects,
  bucketDefaultDate,
  bucketOf,
  byDate,
  isGeneral,
  agendaTasks,
  subjectLabel,
  trips as tripsOf,
  type Bucket,
} from '../lib/model';
import { addDays, fmtDate, today, weekday } from '../lib/dates';
import { moveTask, nextOrder } from '../lib/ops';

const EMPTY_TEXT: Record<Bucket, string> = {
  overdue: 'Nothing overdue.',
  today: 'Nothing due today. Drag a task here to do it today.',
  week: 'Nothing planned for this week.',
  later: 'Nothing further out.',
};

/** Neighbor rule: the date and order a task takes when inserted at `index` among `others`. */
export function placement(bucket: Bucket, others: Task[], index: number): { date: ISODate | null; order: number } {
  const above = others[index - 1];
  const below = others[index];
  if (above && below && above.date === below.date) return { date: above.date, order: (above.order + below.order) / 2 };
  if (above) return { date: above.date ?? bucketDefaultDate(bucket), order: above.order + 1 };
  if (below) return { date: below.date ?? bucketDefaultDate(bucket), order: below.order - 1 };
  return { date: bucketDefaultDate(bucket), order: nextOrder() };
}

export function moveToast(from: ISODate | null, to: ISODate | null): string {
  if (from === to || !to) return 'Order updated';
  const t = today();
  if (to === t) return 'Moved to today';
  if (to === addDays(t, 1)) return 'Moved to tomorrow';
  if (to < t) return `Moved to overdue, ${fmtDate(to, true)}`;
  return `Moved to ${weekday(to)}, ${fmtDate(to, true)}`;
}

interface DragState {
  id: string;
  title: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  target: { bucket: Bucket; index: number } | null;
  line: { top: number; left: number; width: number } | null;
}

export default function Agenda() {
  const { s, apply } = useStore();
  const { openDialog } = useUI();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'done' ? 'done' : 'open';
  const filter = params.get('for') ?? 'all';
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const sectionEls = useRef<Partial<Record<Bucket, HTMLElement | null>>>({});
  const focusAfter = useRef<string | null>(null);

  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v === null) n.delete(k);
    else n.set(k, v);
    setParams(n, { replace: true });
  };

  // `for` is a subject id (older links were "<type>:<id>").
  const forId = filter.includes(':') ? filter.split(':')[1] : filter;
  const matches = (t: Task) => {
    if (filter === 'all') return true;
    if (filter === 'general') return isGeneral(t);
    return t.subjectId === forId;
  };

  // Dated sub-tasks are agenda items of their own (see agendaTasks).
  const items = useMemo(() => agendaTasks(s.tasks), [s.tasks]);
  const open = useMemo(() => items.filter((t) => !t.done && matches(t)).sort(byDate), [items, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const sections = useMemo(
    () => BUCKETS.map((b) => ({ bucket: b, tasks: open.filter((t) => bucketOf(t.date) === b) })),
    [open],
  );
  const done = useMemo(
    () => items.filter((t) => t.done && matches(t)).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')),
    [items, filter], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const commitMove = (task: Task, bucket: Bucket, index: number) => {
    const others = sections.find((x) => x.bucket === bucket)!.tasks.filter((t) => t.id !== task.id);
    const p = placement(bucket, others, index);
    const curIndex = sections.find((x) => x.bucket === bucket)!.tasks.findIndex((t) => t.id === task.id);
    if (curIndex === index && bucketOf(task.date) === bucket) return; // dropped in place
    const changes = moveTask(s, task, p.date, p.order);
    apply(changes, { toast: moveToast(task.date, p.date), undo: true });
  };

  // ── Keyboard ─────────────────────────────────────────────────────────────
  const onGripKey = (task: Task) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const si = sections.findIndex((x) => x.tasks.some((t) => t.id === task.id));
    const sec = sections[si];
    const idx = sec.tasks.findIndex((t) => t.id === task.id);
    focusAfter.current = task.id;
    if (e.key === 'ArrowUp') {
      if (idx > 0) commitMove(task, sec.bucket, idx - 1);
      else if (si > 0) commitMove(task, sections[si - 1].bucket, sections[si - 1].tasks.length);
    } else {
      if (idx < sec.tasks.length - 1) commitMove(task, sec.bucket, idx + 1);
      else if (si < sections.length - 1) commitMove(task, sections[si + 1].bucket, 0);
    }
  };

  useEffect(() => {
    if (!focusAfter.current) return;
    const id = focusAfter.current;
    focusAfter.current = null;
    document.querySelector<HTMLElement>(`[data-grip="${id}"]`)?.focus();
  });

  // ── Pointer drag ─────────────────────────────────────────────────────────
  const computeTarget = (x: number, y: number, id: string): Pick<DragState, 'target' | 'line'> => {
    let best: { bucket: Bucket; dist: number } | null = null;
    for (const b of BUCKETS) {
      const el = sectionEls.current[b];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const dist = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (!best || dist < best.dist) best = { bucket: b, dist };
    }
    if (!best) return { target: null, line: null };
    const el = sectionEls.current[best.bucket]!;
    const list = el.querySelector('.drop-list') as HTMLElement;
    const rows = [...list.querySelectorAll<HTMLElement>('li[data-task-id]')].filter((r) => r.dataset.taskId !== id);
    let index = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    const lr = list.getBoundingClientRect();
    let top: number;
    if (rows.length === 0) top = lr.top + lr.height / 2;
    else if (index < rows.length) top = rows[index].getBoundingClientRect().top;
    else top = rows[rows.length - 1].getBoundingClientRect().bottom;
    void x;
    return { target: { bucket: best.bucket, index }, line: { top, left: lr.left, width: lr.width } };
  };

  const onGripDown = (task: Task) => (e: RPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const st: DragState = {
      id: task.id,
      title: task.title,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      active: false,
      target: null,
      line: null,
    };
    setDrag(st);
  };

  useEffect(() => {
    if (!drag) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const active = cur.active || Math.hypot(e.clientX - cur.startX, e.clientY - cur.startY) > 5;
      const next = { ...cur, x: e.clientX, y: e.clientY, active };
      if (active) Object.assign(next, computeTarget(e.clientX, e.clientY, cur.id));
      dragRef.current = next;
      setDrag(next);
    };
    const end = (e: PointerEvent) => {
      const cur = dragRef.current;
      setDrag(null);
      dragRef.current = null;
      if (!cur || !cur.active || e.type === 'pointercancel') return;
      const task = items.find((t) => t.id === cur.id);
      const tgt = computeTarget(e.clientX, e.clientY, cur.id).target;
      if (task && tgt) commitMove(task, tgt.bucket, tgt.index);
    };
    const tick = () => {
      const cur = dragRef.current;
      if (cur?.active) {
        const edge = 90;
        let dy = 0;
        if (cur.y < edge) dy = -Math.ceil((edge - cur.y) / 6);
        else if (cur.y > window.innerHeight - edge) dy = Math.ceil((cur.y - (window.innerHeight - edge)) / 6);
        if (dy !== 0) {
          window.scrollBy(0, dy);
          const next = { ...cur, ...computeTarget(cur.x, cur.y, cur.id) };
          dragRef.current = next;
          setDrag(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [drag?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = drag?.active ? drag : null;
  const initialFor = filter !== 'all' && filter !== 'general' ? forId : '';

  return (
    <div className={`page ${active ? 'is-dragging' : ''}`}>
      <PageHead
        eyebrow="Everyone and everything"
        title="Agenda"
        actions={
          <button type="button" className="btn primary" onClick={() => openDialog(<AddTaskDialog initialFor={initialFor} />)}>
            <Icon name="plus" /> Add task
          </button>
        }
      />
      <div className="toolbar">
        <Segmented
          label="Show"
          value={tab}
          onChange={(v) => setParam('tab', v === 'open' ? null : v)}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'done', label: 'Done' },
          ]}
        />
        <select aria-label="Filter" className="filter-select" value={filter} onChange={(e) => setParam('for', e.target.value === 'all' ? null : e.target.value)}>
          <option value="all">Everything</option>
          <option value="general">General tasks</option>
          {[...allSubjects(s), ...tripsOf(s)].map((x) => (
            <option key={x.id} value={x.id}>
              {subjectLabel(x)}
            </option>
          ))}
        </select>
      </div>

      {tab === 'open' ? (
        sections.map(({ bucket, tasks }) => (
          <section
            key={bucket}
            ref={(el) => (sectionEls.current[bucket] = el)}
            className={`section drop-section ${active?.target?.bucket === bucket ? 'drop-target' : ''}`}
            aria-label={BUCKET_LABEL[bucket]}
          >
            <SectionHead title={BUCKET_LABEL[bucket]} count={tasks.length} />
            <ul className="list drop-list">
              {tasks.length === 0 && <li className="empty-row">{EMPTY_TEXT[bucket]}</li>}
              {tasks.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  draggable={!t.appointment}
                  dragging={active?.id === t.id}
                  onGripDown={onGripDown(t)}
                  onGripKey={onGripKey(t)}
                />
              ))}
            </ul>
          </section>
        ))
      ) : (
        <section className="section">
          <SectionHead title="Done" count={done.length} />
          {done.length === 0 ? (
            <Empty>Nothing completed yet.</Empty>
          ) : (
            <ul className="list">
              {done.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </ul>
          )}
        </section>
      )}

      {active && (
        <>
          <div className="drag-ghost" style={{ left: active.x + 12, top: active.y - 22 }} aria-hidden="true">
            <Icon name="grip" size={18} />
            {active.title}
          </div>
          {active.line && (
            <div className="drop-line" style={{ top: active.line.top - 1.5, left: active.line.left, width: active.line.width }} aria-hidden="true" />
          )}
        </>
      )}
    </div>
  );
}
