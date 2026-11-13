import type { StepKind, StepPlan } from '../types/coo';
import { IconButton } from '../components/ui';
import { step } from '../lib/templates';

const KINDS: { value: StepKind; label: string }[] = [
  { value: 'plain', label: 'Reminder' },
  { value: 'schedule', label: 'Book an appointment' },
  { value: 'renew', label: 'Renew or mark done' },
];

/**
 * Edits the steps planned before each due date. Each row: title, how many
 * days before the date, and what completing it does. Prep notes and
 * "file the document" links on template steps are kept as they are.
 */
export function StepPlanEditor({
  plan,
  onChange,
  dateLabel,
}: {
  plan: StepPlan[];
  onChange: (next: StepPlan[]) => void;
  dateLabel: string;
}) {
  const set = (i: number, patch: Partial<StepPlan>) => onChange(plan.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const closes = plan.some((p) => p.kind === 'renew' || p.kind === 'schedule');
  return (
    <div className="plan-editor">
      {plan.length === 0 && <div className="muted small">No steps. Add one so coo reminds you before the date.</div>}
      {plan.map((p, i) => (
        <div key={i} className="plan-row">
          <input aria-label="Step title" value={p.title} placeholder="What to do" onChange={(e) => set(i, { title: e.target.value })} />
          <label className="plan-days">
            <input
              type="number"
              min={0}
              max={3650}
              aria-label={`Days before ${dateLabel.toLowerCase()} for ${p.title || 'this step'}`}
              value={-p.offsetDays}
              onChange={(e) => set(i, { offsetDays: -Math.max(0, Math.round(Number(e.target.value) || 0)) })}
            />
            <span className="muted small">days before</span>
          </label>
          <select aria-label={`What completing ${p.title || 'this step'} does`} value={p.kind === 'pickup' ? 'plain' : p.kind} onChange={(e) => set(i, { kind: e.target.value as StepKind })}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <IconButton icon="close" size={16} label={`Remove step ${p.title}`} onClick={() => onChange(plan.filter((_, j) => j !== i))} />
        </div>
      ))}
      <button type="button" className="link" onClick={() => onChange([...plan, step('', -14, plan.length ? 'plain' : 'renew')])}>
        + Add a step
      </button>
      {plan.length > 0 && !closes && (
        <p className="small tone-warn">
          No step books an appointment or renews, so coo can’t roll this over to the next date on its own.
        </p>
      )}
    </div>
  );
}

/** Drops untitled rows before saving. */
export function cleanPlan(plan: StepPlan[]): StepPlan[] {
  return plan.map((p) => ({ ...p, title: p.title.trim() })).filter((p) => p.title);
}
