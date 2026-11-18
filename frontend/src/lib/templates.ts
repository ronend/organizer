/** Routine templates by area. Steps are relative to the due date; follow-ups to completion. */
import type { DocumentRequest, RoutineArea, StepKind, StepPlan } from '../types/coo';

export interface RoutineTemplate {
  key: string;
  area: RoutineArea;
  title: string;
  description: string;
  icon: string;
  dateLabel: string;
  repeatMonths: number | null;
  countFrom: 'done' | 'due';
  plan: StepPlan[];
  followUps: StepPlan[];
  /** History wording on completion, e.g. "Passed" → "Passed at Eli's Auto Service". */
  doneVerb: string;
  /** Sentence shown in the New routine form instead of the schedule details. */
  summary: string;
  medication?: boolean;
}

export function step(
  title: string,
  offsetDays: number,
  kind: StepKind = 'plain',
  extra: { prep?: string; requestsDocument?: DocumentRequest } = {},
): StepPlan {
  return { title, offsetDays, kind, prep: extra.prep ?? '', requestsDocument: extra.requestsDocument ?? null };
}

const visitSummary = step('File the visit summary', 1, 'plain', {
  requestsDocument: { category: 'health', type: 'Visit summary' },
});

function bookable(
  key: string,
  title: string,
  description: string,
  icon: string,
  repeatMonths: number | null,
  bookTitle: string,
  opts: { summary?: boolean; dateLabel?: string } = {},
): RoutineTemplate {
  return {
    key,
    area: 'health',
    title,
    description,
    icon,
    dateLabel: opts.dateLabel ?? 'Next due',
    repeatMonths,
    countFrom: 'done',
    plan: [step(bookTitle, -21, 'schedule')],
    followUps: opts.summary ? [visitSummary] : [],
    doneVerb: 'Visit',
    summary: `coo reminds you to ${bookTitle.toLowerCase()} 21 days before it is due, then tracks the appointment${
      opts.summary ? ' and asks you to file the visit summary' : ''
    }.`,
  };
}

export const TEMPLATES: RoutineTemplate[] = [
  // ── Car ──
  {
    key: 'car-insurance',
    area: 'car',
    title: 'Car insurance',
    description: 'Policy renewal. Compare quotes before it rolls over.',
    icon: 'shield',
    dateLabel: 'Expires',
    repeatMonths: 12,
    countFrom: 'due',
    plan: [step('Compare insurance quotes', -30), step('Renew car insurance', -7, 'renew')],
    followUps: [
      step('Put the new insurance card in the glovebox', 0, 'plain', {
        requestsDocument: { category: 'car', type: 'ID card' },
      }),
    ],
    doneVerb: 'Renewed',
    summary: 'coo reminds you to compare quotes 30 days before the policy expires and to renew it 7 days before.',
  },
  {
    key: 'safety-inspection',
    area: 'car',
    title: 'Safety inspection',
    description: 'Yearly state safety inspection.',
    icon: 'stamp',
    dateLabel: 'Due',
    repeatMonths: 12,
    countFrom: 'due',
    plan: [step('Schedule safety inspection', -14, 'schedule')],
    followUps: [
      step('File the inspection report', 0, 'plain', { requestsDocument: { category: 'car', type: 'Inspection' } }),
    ],
    doneVerb: 'Passed',
    summary: 'coo reminds you to schedule the inspection 14 days before it is due, then tracks the appointment.',
  },
  {
    key: 'registration',
    area: 'car',
    title: 'State registration',
    description: 'Registration renewal with the DMV.',
    icon: 'document',
    dateLabel: 'Valid until',
    repeatMonths: 12,
    countFrom: 'due',
    plan: [step('Renew registration', -14, 'renew')],
    followUps: [
      step('File the new registration', 0, 'plain', { requestsDocument: { category: 'car', type: 'Registration' } }),
    ],
    doneVerb: 'Renewed',
    summary: 'coo reminds you to renew the registration 14 days before it expires.',
  },
  {
    key: 'car-service',
    area: 'car',
    title: 'Regular service',
    description: 'Oil, filters and a general check.',
    icon: 'wrench',
    dateLabel: 'Next due',
    repeatMonths: 12,
    countFrom: 'done',
    plan: [step('Book car service', -21, 'schedule')],
    followUps: [],
    doneVerb: 'Serviced',
    summary: 'coo reminds you to book the service 21 days before it is due, then tracks the appointment.',
  },

  // ── Health ──
  bookable('annual-checkup', 'Annual checkup', 'Yearly physical with the family doctor.', 'stethoscope', 12, 'Book annual checkup', { summary: true }),
  bookable('dental-cleaning', 'Dental cleaning', 'Cleaning and checkup every six months.', 'tooth', 6, 'Book dental cleaning'),
  bookable('eye-exam', 'Eye exam', 'Vision check with the optician.', 'eye', 24, 'Book eye exam'),
  bookable('vaccinations', 'Vaccinations', 'Keep shots up to date.', 'syringe', 12, 'Book vaccination appointment'),
  bookable('specialist', 'Specialist follow-up', 'A follow-up visit with a specialist.', 'bone', null, 'Book specialist follow-up', { summary: true }),
  {
    key: 'lab-tests',
    area: 'health',
    title: 'Recurring lab tests',
    description: 'Blood work ordered by the doctor.',
    icon: 'flask',
    dateLabel: 'Next due',
    repeatMonths: 6,
    countFrom: 'done',
    plan: [step('Schedule lab tests', -14, 'schedule', { prep: 'Fast for 12 hours before the test' })],
    followUps: [
      step('Upload the lab results', 3, 'plain', { requestsDocument: { category: 'health', type: 'Result' } }),
      step('Book the follow-up visit', 7),
    ],
    doneVerb: 'Tested',
    summary:
      'coo reminds you to schedule the tests 14 days before they are due (with a fasting note), then to upload the results and book the follow-up visit.',
  },
  {
    key: 'medication',
    area: 'health',
    title: 'Medication refill',
    description: 'Track supply and refills.',
    icon: 'pill',
    dateLabel: 'Runs out',
    repeatMonths: null,
    countFrom: 'done',
    plan: [],
    followUps: [],
    doneVerb: 'Refilled',
    summary: 'coo tracks the supply and reminds you to order and pick up refills before it runs out.',
    medication: true,
  },

  // ── Identity ──
  {
    key: 'passport',
    area: 'identity',
    title: 'Passport renewal',
    description: 'Renew well before travel. Many countries require 6 months of validity.',
    icon: 'idcard',
    dateLabel: 'Expires',
    repeatMonths: 120,
    countFrom: 'due',
    plan: [
      step('Check renewal requirements and get a photo', -210),
      step('Submit passport renewal', -180, 'renew'),
    ],
    followUps: [
      step('Add the new passport to documents', 0, 'plain', {
        requestsDocument: { category: 'identity', type: 'Passport' },
      }),
    ],
    doneVerb: 'Renewed',
    summary:
      'coo reminds you to check the requirements and get a photo 210 days before expiry, and to submit the renewal 180 days before.',
  },
  {
    key: 'driver-license',
    area: 'identity',
    title: 'Driver license renewal',
    description: 'Renew the driver license before it expires.',
    icon: 'idcard',
    dateLabel: 'Expires',
    repeatMonths: 96,
    countFrom: 'due',
    plan: [step('Renew driver license', -60, 'renew')],
    followUps: [
      step('Add the new driver license to documents', 0, 'plain', {
        requestsDocument: { category: 'identity', type: 'Driver license' },
      }),
    ],
    doneVerb: 'Renewed',
    summary: 'coo reminds you to renew the license 60 days before it expires.',
  },
  {
    key: 'city-id',
    area: 'identity',
    title: 'City or state ID renewal',
    description: 'Renew the ID card before it expires.',
    icon: 'idcard',
    dateLabel: 'Expires',
    repeatMonths: 60,
    countFrom: 'due',
    plan: [step('Renew ID card', -60, 'renew')],
    followUps: [
      step('Add the new ID card to documents', 0, 'plain', {
        requestsDocument: { category: 'identity', type: 'City or state ID' },
      }),
    ],
    doneVerb: 'Renewed',
    summary: 'coo reminds you to renew the ID 60 days before it expires.',
  },
];

export function templatesFor(area: RoutineArea): RoutineTemplate[] {
  return TEMPLATES.filter((t) => t.area === area);
}

export function templateByKey(key: string | null | undefined): RoutineTemplate | undefined {
  return key ? TEMPLATES.find((t) => t.key === key) : undefined;
}

export const AREA_LABEL: Record<RoutineArea, string> = { health: 'Health', identity: 'Identity', car: 'Car' };
export const AREA_ICON: Record<RoutineArea, string> = { health: 'stethoscope', identity: 'idcard', car: 'car' };

export const REPEAT_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Doesn't repeat" },
  { value: 1, label: 'Every month' },
  { value: 3, label: 'Every 3 months' },
  { value: 6, label: 'Every 6 months' },
  { value: 12, label: 'Every year' },
  { value: 24, label: 'Every 2 years' },
  { value: 60, label: 'Every 5 years' },
  { value: 96, label: 'Every 8 years' },
  { value: 120, label: 'Every 10 years' },
];

export function repeatText(months: number | null): string {
  if (!months) return "doesn't repeat";
  if (months % 12 === 0) {
    const y = months / 12;
    return y === 1 ? 'every 12 months' : `every ${y} years`;
  }
  return months === 1 ? 'every month' : `every ${months} months`;
}

/** Plan for a Blank routine with a date. */
export function blankPlan(
  area: RoutineArea,
  title: string,
  remindDays: number,
  needsBooking: boolean,
): StepPlan[] {
  if (needsBooking) return [step(`Book ${lowerFirst(title)}`, -remindDays, 'schedule')];
  return [step(area === 'identity' ? `Renew ${lowerFirst(title)}` : title, -remindDays, 'renew')];
}

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

export function defaultRemindDays(area: RoutineArea): number {
  return area === 'identity' ? 90 : 14;
}
