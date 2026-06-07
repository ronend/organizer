import type { Segment, SegmentType } from '../types/organizer';

export type FieldInput = 'text' | 'date' | 'time' | 'datetime-local' | 'textarea';

export interface FieldSpec {
  key: string;
  label: string;
  input: FieldInput;
}

export interface SegmentSpec {
  type: SegmentType;
  icon: string;
  label: string;
  fields: FieldSpec[];
  /** One-line summary for the collapsed card. */
  summary: (f: Record<string, string>) => string;
}

const t = (key: string, label: string): FieldSpec => ({ key, label, input: 'text' });
const dt = (key: string, label: string): FieldSpec => ({ key, label, input: 'datetime-local' });
const date = (key: string, label: string): FieldSpec => ({ key, label, input: 'date' });
const time = (key: string, label: string): FieldSpec => ({ key, label, input: 'time' });
const notes: FieldSpec = { key: 'notes', label: 'Notes', input: 'textarea' };

/** Short, friendly rendering of a date / datetime-local field value. */
function when(v?: string): string {
  if (!v) return '';
  const hasTime = v.includes('T');
  // Date-only values must be parsed as local midnight, else `new Date('2026-06-14')`
  // is treated as UTC and shifts back a day in western timezones.
  const d = new Date(hasTime ? v : `${v}T00:00`);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(hasTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

function range(a?: string, b?: string): string {
  const x = when(a);
  const y = when(b);
  if (x && y) return `${x}–${y}`;
  return x || y || '';
}

function join(parts: (string | undefined)[], sep = ' · '): string {
  return parts.filter((p) => p && p.trim()).join(sep);
}

export const SEGMENT_SPECS: Record<SegmentType, SegmentSpec> = {
  flight: {
    type: 'flight',
    icon: '✈️',
    label: 'Flight',
    fields: [
      t('airline', 'Airline'),
      t('flightNumber', 'Flight number'),
      t('from', 'Departure airport'),
      t('to', 'Arrival airport'),
      dt('departAt', 'Departure'),
      dt('arriveAt', 'Arrival'),
      t('confirmation', 'Confirmation number'),
      t('seat', 'Seat'),
      notes,
    ],
    summary: (f) =>
      join([f.from && f.to ? `${f.from} → ${f.to}` : f.airline, when(f.departAt)]) ||
      'Flight',
  },
  hotel: {
    type: 'hotel',
    icon: '🏨',
    label: 'Hotel',
    fields: [
      t('name', 'Hotel name'),
      t('address', 'Address'),
      date('checkIn', 'Check-in'),
      date('checkOut', 'Check-out'),
      t('confirmation', 'Confirmation number'),
      t('phone', 'Phone'),
      notes,
    ],
    summary: (f) => join([f.name, range(f.checkIn, f.checkOut)]) || 'Hotel',
  },
  car: {
    type: 'car',
    icon: '🚗',
    label: 'Car Rental',
    fields: [
      t('company', 'Company'),
      t('pickupLocation', 'Pickup location'),
      t('returnLocation', 'Return location'),
      dt('pickupAt', 'Pickup'),
      dt('returnAt', 'Return'),
      t('confirmation', 'Confirmation number'),
      notes,
    ],
    summary: (f) => join([f.company, range(f.pickupAt, f.returnAt)]) || 'Car Rental',
  },
  activity: {
    type: 'activity',
    icon: '🎭',
    label: 'Activity',
    fields: [
      t('name', 'Name'),
      date('date', 'Date'),
      time('time', 'Time'),
      t('address', 'Address'),
      t('booking', 'Booking reference'),
      notes,
    ],
    summary: (f) => join([f.name, join([when(f.date), f.time], ' ')]) || 'Activity',
  },
  train: {
    type: 'train',
    icon: '🚂',
    label: 'Train / Bus',
    fields: [
      t('operator', 'Operator'),
      t('from', 'From'),
      t('to', 'To'),
      dt('departAt', 'Departure'),
      dt('arriveAt', 'Arrival'),
      t('booking', 'Booking reference'),
      t('seat', 'Seat'),
      notes,
    ],
    summary: (f) =>
      join([f.from && f.to ? `${f.from} → ${f.to}` : f.operator, when(f.departAt)]) ||
      'Train / Bus',
  },
  note: {
    type: 'note',
    icon: '📝',
    label: 'Note',
    fields: [
      { key: 'text', label: 'Note', input: 'textarea' },
      date('date', 'Date'),
    ],
    summary: (f) => {
      const line = (f.text || '').split('\n')[0].slice(0, 60);
      return join([line, when(f.date)]) || 'Note';
    },
  },
};

export const SEGMENT_ORDER: SegmentType[] = [
  'flight',
  'hotel',
  'car',
  'activity',
  'train',
  'note',
];

let _seq = 0;
/** A fresh empty segment of the given type with a unique id. */
export function newSegment(type: SegmentType): Segment {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `seg-${Date.now()}-${_seq++}`;
  return { id, type, fields: {} };
}

export function segmentSummary(seg: Segment): string {
  const spec = SEGMENT_SPECS[seg.type];
  return `${spec.icon} ${spec.summary(seg.fields ?? {})}`;
}
