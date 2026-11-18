import type { ISODate, Reservation, ReservationType, Subject } from '../types/coo';
import { fieldText } from './registry';
import { tripInfo } from './model';
import { addDays, datePart, timePart } from './dates';

export interface ResTypeMeta {
  label: string;
  plural: string;
  icon: string;
  start: string;
  end: string;
  /** Words on the timeline when a reservation spans days. */
  startWord: string;
  endWord: string;
  address: string;
  placeholder: string;
  addressPlaceholder: string;
}

export const RES_TYPES: Record<ReservationType, ResTypeMeta> = {
  flight: { label: 'Flight', plural: 'Flights', icon: 'plane', start: 'Departure', end: 'Arrival', startWord: 'Departs', endWord: 'Arrives', address: 'Airport or terminal', placeholder: 'TAP 210 · New York to Lisbon', addressPlaceholder: 'JFK Terminal 1' },
  stay: { label: 'Stay', plural: 'Stays', icon: 'bed', start: 'Check-in', end: 'Check-out', startWord: 'Check-in', endWord: 'Check-out', address: 'Address', placeholder: 'Hotel Baixa Boutique', addressPlaceholder: 'Rua Augusta 100, Lisbon' },
  car: { label: 'Car rental', plural: 'Car rentals', icon: 'car', start: 'Pick-up', end: 'Drop-off', startWord: 'Pick up', endWord: 'Drop off', address: 'Pick-up location', placeholder: 'Compact SUV rental', addressPlaceholder: 'Lisbon Airport, rental desks' },
  activity: { label: 'Activity', plural: 'Activities', icon: 'ticket', start: 'Starts', end: 'Ends', startWord: 'Starts', endWord: 'Ends', address: 'Address or meeting point', placeholder: 'Pena Palace tickets', addressPlaceholder: 'Estrada da Pena, Sintra' },
  hike: { label: 'Hike', plural: 'Hikes', icon: 'trail', start: 'Starts', end: 'Ends', startWord: 'Starts', endWord: 'Ends', address: 'Trailhead', placeholder: 'Sintra ridge loop', addressPlaceholder: 'Trailhead parking' },
  train: { label: 'Train or transfer', plural: 'Trains and transfers', icon: 'train', start: 'Departure', end: 'Arrival', startWord: 'Departs', endWord: 'Arrives', address: 'Station', placeholder: 'Train to Sintra', addressPlaceholder: 'Rossio station' },
  other: { label: 'Other', plural: 'Other', icon: 'pin', start: 'Starts', end: 'Ends', startWord: 'Starts', endWord: 'Ends', address: 'Address or location', placeholder: 'Dinner reservation', addressPlaceholder: 'Address' },
};

export const RES_ORDER: ReservationType[] = ['flight', 'stay', 'car', 'activity', 'hike', 'train', 'other'];

/** Trim, add https:// when missing, drop anything that is not http(s). */
export function cleanLink(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

export function siteName(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return link;
  }
}

export function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export type TimelineEntry =
  | { kind: 'event'; res: Reservation; time: string; label: string | null; edge: 'start' | 'end' | 'single' }
  | { kind: 'quiet'; res: Reservation; text: string };

export interface TimelineDay {
  date: ISODate;
  dayNumber: number;
  entries: TimelineEntry[];
}

/**
 * One section per day from start to end, extended to cover any reservation.
 * Multi-day reservations appear at their start and their end; stays and car
 * rentals add a quiet line on each day in between.
 */
export function buildTimeline(tripSubject: Subject, list: Reservation[]): TimelineDay[] {
  const trip = tripInfo(tripSubject);
  let first = trip.start;
  let last = trip.end;
  for (const r of list) {
    const sd = datePart(r.start);
    const ed = r.end ? datePart(r.end) : sd;
    if (sd < first) first = sd;
    if (ed > last) last = ed;
  }
  const days: TimelineDay[] = [];
  const startIdx = (d: ISODate) => {
    let n = 1;
    let cur = trip.start;
    if (d >= cur) {
      while (cur < d) {
        cur = addDays(cur, 1);
        n++;
      }
      return n;
    }
    while (cur > d) {
      cur = addDays(cur, -1);
      n--;
    }
    return n;
  };
  for (let d = first; d <= last; d = addDays(d, 1)) days.push({ date: d, dayNumber: startIdx(d), entries: [] });
  const byDate = new Map(days.map((x) => [x.date, x]));

  for (const r of list) {
    const meta = RES_TYPES[r.type];
    const sd = datePart(r.start);
    const ed = r.end ? datePart(r.end) : sd;
    if (sd === ed) {
      const time = r.end && timePart(r.end) !== timePart(r.start) ? `${timePart(r.start)}–${timePart(r.end)}` : timePart(r.start);
      byDate.get(sd)?.entries.push({ kind: 'event', res: r, time, label: null, edge: 'single' });
      continue;
    }
    byDate.get(sd)?.entries.push({ kind: 'event', res: r, time: timePart(r.start), label: meta.startWord, edge: 'start' });
    byDate.get(ed)?.entries.push({ kind: 'event', res: r, time: timePart(r.end!), label: meta.endWord, edge: 'end' });
    if (r.type === 'stay' || r.type === 'car') {
      for (let d = addDays(sd, 1); d < ed; d = addDays(d, 1)) {
        byDate.get(d)?.entries.push({
          kind: 'quiet',
          res: r,
          text: r.type === 'stay' ? `Staying at ${r.title}` : `Car rental · ${r.title}`,
        });
      }
    }
  }
  for (const d of days) {
    d.entries.sort((a, b) => {
      if (a.kind === 'quiet' && b.kind !== 'quiet') return -1;
      if (b.kind === 'quiet' && a.kind !== 'quiet') return 1;
      const ta = a.kind === 'event' ? a.time : '';
      const tb = b.kind === 'event' ? b.time : '';
      return ta.localeCompare(tb);
    });
  }
  return days;
}

/** A reservation's registry field as text (address, confirmation, link, details). */
export function resField(r: Reservation, key: 'address' | 'confirmation' | 'link' | 'details'): string {
  return fieldText(r.fields, key);
}
