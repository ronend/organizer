/**
 * Demo household (spec "Demo data"). Dates are relative to today. Loaded on
 * request from the empty Home screen; sample images are generated as SVGs and
 * uploaded like any other file.
 */
import type { Assignment, ChangeSet, Contact, CooState, Document, FileRef, Reservation, Routine, Subject, Task } from '../types/coo';
import { uploadFile } from '../api/client';
import { addDays, today } from './dates';
import {
  Tx,
  makeAssignment,
  makeContact,
  makeDocument,
  makeReservation,
  makeRoutine,
  makeSubject,
  makeTask,
  planCycle,
  syncTripTasks,
} from './ops';
import { templateByKey, blankPlan } from './templates';
import { runOutDate, stepKindOf } from './model';

const T = (n: number) => addDays(today(), n);
const DT = (n: number, hm: string) => `${T(n)}T${hm}`;

function svg(w: number, h: number, body: string): Blob {
  return new Blob(
    [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Inter, Helvetica, Arial, sans-serif">${body}</svg>`],
    { type: 'image/svg+xml' },
  );
}

function idFront(title: string, name: string, number: string, color: string): Blob {
  return svg(
    856,
    540,
    `<rect width="856" height="540" rx="34" fill="${color}"/>
     <rect x="0" y="0" width="856" height="96" rx="34" fill="#ffffff" fill-opacity=".18"/>
     <text x="40" y="62" font-size="34" font-weight="600" fill="#fff">${title}</text>
     <rect x="40" y="140" width="220" height="280" rx="16" fill="#ffffff" fill-opacity=".85"/>
     <circle cx="150" cy="240" r="58" fill="${color}" fill-opacity=".55"/>
     <rect x="80" y="310" width="140" height="80" rx="40" fill="${color}" fill-opacity=".55"/>
     <text x="300" y="190" font-size="22" fill="#fff" fill-opacity=".8">NAME</text>
     <text x="300" y="228" font-size="34" font-weight="600" fill="#fff">${name}</text>
     <text x="300" y="290" font-size="22" fill="#fff" fill-opacity=".8">NUMBER</text>
     <text x="300" y="328" font-size="32" fill="#fff">${number}</text>
     <text x="300" y="400" font-size="20" fill="#fff" fill-opacity=".8">SAMPLE · NOT A REAL DOCUMENT</text>`,
  );
}

function idBack(color: string): Blob {
  const bars = Array.from({ length: 60 }, (_, i) => `<rect x="${60 + i * 12.3}" y="380" width="${(i * 7) % 3 === 0 ? 7 : 3}" height="110" fill="#1E2226"/>`).join('');
  return svg(
    856,
    540,
    `<rect width="856" height="540" rx="34" fill="#F3F1EC"/>
     <rect x="0" y="40" width="856" height="80" fill="${color}" fill-opacity=".85"/>
     <text x="60" y="200" font-size="24" fill="#6B7075">Endorsements: none</text>
     <text x="60" y="244" font-size="24" fill="#6B7075">Restrictions: corrective lenses</text>
     <text x="60" y="300" font-size="20" fill="#9A9FA4">SAMPLE · NOT A REAL DOCUMENT</text>${bars}`,
  );
}

function qr(x: number, y: number, size: number, seed: number): string {
  const n = 21;
  const c = size / n;
  let out = '';
  let v = seed;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      v = (v * 1103515245 + 12345) & 0x7fffffff;
      const finder = (i < 7 && j < 7) || (i < 7 && j > 13) || (i > 13 && j < 7);
      const on = finder ? i % 6 === 0 || j % 6 === 0 || (i % 14 > 1 && i % 14 < 5 && j % 14 > 1 && j % 14 < 5) || i === 20 || j === 20 : v % 3 === 0;
      if (on) out += `<rect x="${x + j * c}" y="${y + i * c}" width="${c}" height="${c}" fill="#000"/>`;
    }
  return out;
}

function ticket(title: string, line: string, code: string, seed: number): Blob {
  return svg(
    900,
    420,
    `<rect width="900" height="420" rx="24" fill="#fff" stroke="#ECEAE5" stroke-width="2"/>
     <text x="40" y="70" font-size="20" fill="#6B7075">SAMPLE TICKET</text>
     <text x="40" y="120" font-size="36" font-weight="600" fill="#1E2226">${title}</text>
     <text x="40" y="170" font-size="24" fill="#1E2226">${line}</text>
     <text x="40" y="250" font-size="20" fill="#6B7075">Booking reference</text>
     <text x="40" y="296" font-size="40" font-weight="600" fill="#1E2226" letter-spacing="4">${code}</text>
     ${qr(600, 60, 280, seed)}`,
  );
}

async function up(blob: Blob, name: string): Promise<FileRef> {
  return uploadFile(blob, name);
}

/** Builds the whole household in one change set. */
export async function buildDemo(s: CooState): Promise<ChangeSet> {
  const tx = new Tx(s);
  let stamp = Date.now() - 100_000;
  const seq = <X extends { createdAt: string; updatedAt: string }>(x: X): X => {
    const iso = new Date((stamp += 10)).toISOString();
    return { ...x, createdAt: iso, updatedAt: iso };
  };

  // ── People, cars, contacts ──
  const person = (name: string, birthYear: number) =>
    tx.put(seq(makeSubject({ subjectType: 'person', name, notes: '', attributes: { birthYear } })));
  const car = (name: string, plate: string, odometer: number) =>
    tx.put(seq(makeSubject({ subjectType: 'car', name, notes: '', attributes: { plate, odometer } })));
  const alex = person('Alex', 1984);
  const maya = person('Maya', 1985);
  const noa = person('Noa', 2016);
  const ben = person('Ben', 2019);
  const civic = car('Honda Civic', 'KDR 4821', 48210);
  const yaris = car('Toyota Yaris', 'LMN 7305', 31950);
  const birthYear = (who: Subject) => who.attributes.birthYear as number;

  // Contacts are linked to the subjects they serve as routines use them (below).
  const contacts = new Map<string, Contact>();
  const c = (name: string, role: string, phone: string, group: 'health' | 'cars' | 'other', notes = '') => {
    const k = tx.put(makeContact({ name, role, phone, email: '', notes, tags: [group], links: [] }));
    contacts.set(k.id, k);
    return k;
  };
  const link = (contactId: string, subjectId: string) => {
    const cur = contacts.get(contactId);
    if (!cur || cur.links.some((l) => l.subjectId === subjectId)) return;
    contacts.set(contactId, tx.put({ ...cur, links: [...cur.links, { subjectId, role: cur.role }] }));
  };
  const garage = c('Eli’s Auto Service', 'Garage', '555-0142', 'cars', 'Closed Sundays');
  const agent = c('Dana Brooks', 'Insurance agent', '555-0178', 'cars');
  c('Roadside help', 'Roadside assistance', '555-0100', 'cars', 'Member no. 88123');
  const doctor = c('Dr. Sarah Levi', 'Family doctor', '555-0111', 'health');
  const pediatrician = c('Dr. Omar Haddad', 'Pediatrician', '555-0123', 'health', 'Same-day sick visits before 10:00');
  const dentist = c('Bright Smile Dental', 'Dentist', '555-0135', 'health');
  const ortho = c('Dr. Paul Kim', 'Orthopedist', '555-0147', 'health');
  const optician = c('Clear View Optics', 'Optician', '555-0159', 'health');
  const lab = c('City Lab', 'Lab', '555-0161', 'health', 'Walk-ins 07:00–11:00');
  c('Main St Pharmacy', 'Pharmacy', '555-0170', 'health');

  // ── Routines ──
  const fromTemplate = (key: string, over: Partial<Routine> = {}) => {
    const t = templateByKey(key)!;
    return tx.put(
      makeRoutine({
        area: t.area,
        template: t.key,
        icon: t.icon,
        title: t.title,
        description: t.description,
        dateLabel: t.dateLabel,
        plan: t.plan,
        followUps: t.followUps,
        repeatMonths: t.repeatMonths,
        countFrom: t.countFrom,
        extension: t.medication ? { medication: true } : null,
        ...over,
      }),
    );
  };
  const assign = (r: Routine, _type: 'person' | 'car', id: string, date: string | null, extra: Partial<Assignment> = {}) => {
    const a = tx.put(makeAssignment({ routineId: r.id, subjectId: id, date, repeatMonths: r.repeatMonths, ...extra }));
    if (a.contactId) link(a.contactId, id);
    const tasks = date ? planCycle(r, a, date) : [];
    tasks.forEach((t) => tx.put(t));
    return { a, tasks };
  };
  /** Book an appointment for the schedule step of an assignment. */
  const book = (a: Assignment, tasks: Task[], r: Routine, date: string, time: string, providerId: string, prep = '') => {
    const step = tasks.find((t) => stepKindOf(t) === 'schedule');
    if (step) tx.put({ ...step, done: true, doneAt: new Date().toISOString() });
    tx.put(
      makeTask({
        title: r.title,
        date,
        subjectId: a.subjectId,
        source: { kind: 'assignment', id: a.id, step: 'renew' },
        appointment: { time, providerId, providerNote: '', prep },
      }),
    );
    link(providerId, a.subjectId);
  };

  const insurance = fromTemplate('car-insurance');
  const civicIns = assign(insurance, 'car', civic.id, T(45), { contactId: agent.id });
  const yarisIns = assign(insurance, 'car', yaris.id, T(120), { contactId: agent.id });

  const inspection = fromTemplate('safety-inspection');
  const civicInsp = assign(inspection, 'car', civic.id, T(10), {
    contactId: garage.id,
    history: [{ date: T(-355), text: 'Passed at Eli’s Auto Service' }],
  });
  // Unbooked and overdue to schedule.
  civicInsp.tasks.forEach((t) => tx.put({ ...t, date: T(-4) }));
  assign(inspection, 'car', yaris.id, T(200), { contactId: garage.id });

  const registration = fromTemplate('registration');
  const civicReg = assign(registration, 'car', civic.id, T(150));
  const yarisReg = assign(registration, 'car', yaris.id, T(20));

  const service = fromTemplate('car-service');
  assign(service, 'car', civic.id, T(60), { contactId: garage.id });
  const yarisService = assign(service, 'car', yaris.id, T(12), { contactId: garage.id });
  book(yarisService.a, yarisService.tasks, service, T(5), '08:30', garage.id);

  const kit = tx.put(
    makeRoutine({
      area: 'car', template: null, icon: 'car', title: 'Emergency kit',
      description: 'First aid kit, warning triangle, jumper cables and a flashlight. Check it twice a year.',
      dateLabel: 'Due', plan: blankPlan('car', 'Emergency kit', 14, false), followUps: [], repeatMonths: null, countFrom: 'done', extension: null,
    }),
  );
  assign(kit, 'car', civic.id, null);
  assign(kit, 'car', yaris.id, null);

  // Health
  const checkup = fromTemplate('annual-checkup');
  assign(checkup, 'person', alex.id, T(80), { contactId: doctor.id });
  assign(checkup, 'person', noa.id, T(25), { contactId: pediatrician.id });
  assign(checkup, 'person', ben.id, T(150), { contactId: pediatrician.id });

  const dental = fromTemplate('dental-cleaning');
  const mayaDental = assign(dental, 'person', maya.id, T(15), { contactId: dentist.id });
  book(mayaDental.a, mayaDental.tasks, dental, T(9), '16:00', dentist.id);
  assign(dental, 'person', ben.id, T(40), { contactId: dentist.id });

  const labs = fromTemplate('lab-tests');
  assign(labs, 'person', alex.id, T(30), { contactId: lab.id });

  const specialist = fromTemplate('specialist', { title: 'Orthopedist follow-up', description: 'Knee check after physical therapy.' });
  const alexOrtho = assign(specialist, 'person', alex.id, T(4), {
    contactId: ortho.id,
    history: [{ date: T(-30), text: 'Visit at Dr. Paul Kim' }],
  });
  book(alexOrtho.a, alexOrtho.tasks, specialist, T(3), '11:15', ortho.id, 'Bring the MRI report');
  tx.put(
    makeTask({
      title: 'Orthopedist follow-up', date: T(-30), done: true, doneAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      subjectId: alex.id, source: { kind: 'assignment', id: alexOrtho.a.id, step: 'renew' },
      appointment: { time: '10:00', providerId: ortho.id, providerNote: '', prep: '' },
      notes: 'Physical therapy twice a week for six weeks.',
    }),
  );

  const eye = fromTemplate('eye-exam');
  assign(eye, 'person', maya.id, T(100), { contactId: optician.id });

  const vacc = fromTemplate('vaccinations');
  assign(vacc, 'person', ben.id, T(60), { contactId: pediatrician.id });

  const inhaler = fromTemplate('medication', { title: 'Inhaler', description: 'Rescue inhaler. Keep one at school.' });
  const noaSupply = { onHand: 12, asOf: today(), perDay: 2, unit: 'puffs', perRefill: 200, refillsLeft: 0, orderLeadDays: 7 };
  const noaInhaler = assign(inhaler, 'person', noa.id, runOutDate(noaSupply), { supply: noaSupply, contactId: pediatrician.id });
  noaInhaler.tasks.forEach((t) => tx.put({ ...t, date: stepKindOf(t) === 'pickup' ? T(1) : T(-1) }));

  const allergy = fromTemplate('medication', { title: 'Allergy tablets', description: 'Daily during spring.' });
  const maySupply = { onHand: 40, asOf: today(), perDay: 1, unit: 'tablets', perRefill: 30, refillsLeft: 2, orderLeadDays: 7 };
  assign(allergy, 'person', maya.id, runOutDate(maySupply), { supply: maySupply });

  const forms = tx.put(
    makeRoutine({
      area: 'health', template: null, icon: 'document', title: 'School medical forms',
      description: 'Health form and vaccination record for the new school year.',
      dateLabel: 'Due', plan: blankPlan('health', 'School medical forms', 14, false), followUps: [], repeatMonths: 12, countFrom: 'due', extension: null,
    }),
  );
  assign(forms, 'person', noa.id, null);
  assign(forms, 'person', ben.id, null);

  // Identity
  const passport = fromTemplate('passport');
  const license = fromTemplate('driver-license');
  const cityId = fromTemplate('city-id');

  const [licFront, licBack, idFrontImg, idBackImg, ppFront, boarding, pena] = await Promise.all([
    up(idFront('DRIVER LICENSE', 'ALEX MORGAN', 'D123-4567-8901', '#2F566B'), 'alex-license-front.svg'),
    up(idBack('#2F566B'), 'alex-license-back.svg'),
    up(idFront('CITY ID', 'MAYA MORGAN', 'NYC 5520 1187', '#5B4B8A'), 'maya-id-front.svg'),
    up(idBack('#5B4B8A'), 'maya-id-back.svg'),
    up(idFront('PASSPORT', 'ALEX MORGAN', '•• 4492', '#1F3A5F'), 'alex-passport-front.svg'),
    up(ticket('TAP 202 · EWR to LIS', 'Boarding pass · Seat 23A · Group 3', 'XK7P2Q', 7), 'boarding-pass.svg'),
    up(ticket('Pena Palace and Park', '4 tickets · 10:00 entry', 'PENA-3341', 11), 'pena-tickets.svg'),
  ]);

  const files = (front: FileRef | null, back: FileRef | null = null) => [
    ...(front ? [{ role: 'front', file: front }] : []),
    ...(back ? [{ role: 'back', file: back }] : []),
  ];
  const pp = (who: typeof alex, expiry: string, issued: string, number: string, front: FileRef | null) => {
    const { a } = assign(passport, 'person', who.id, expiry);
    tx.put(
      makeDocument({
        category: 'identity', subjectId: who.id, title: `${who.name}’s passport`, type: 'Passport',
        files: files(front), assignmentId: a.id, expiry: { validUntil: expiry, outdated: false },
        fields: {
          idNumber: number, issuer: 'U.S. Department of State', issueDate: issued,
          fullName: `${who.name} Morgan`, nationality: 'United States of America', placeOfBirth: 'New York, U.S.A.',
          dateOfBirth: `${birthYear(who)}-04-12`,
        },
        pinned: who.id === alex.id,
      }),
    );
  };
  pp(alex, T(205), addDays(T(205), -3652), '584934492', ppFront);
  pp(maya, T(1400), addDays(T(1400), -3652), '573118820', null);
  pp(noa, T(900), addDays(T(900), -1826), '590227341', null);
  pp(ben, T(-40), addDays(T(-40), -1826), '561004417', null);

  const lic = assign(license, 'person', alex.id, T(600));
  tx.put(
    makeDocument({
      category: 'identity', subjectId: alex.id, title: 'Alex’s driver license', type: 'Driver license',
      files: files(licFront, licBack), assignmentId: lic.a.id, pinned: true, expiry: { validUntil: T(600), outdated: false },
      fields: {
        idNumber: 'D12345678901', issuer: 'New York State DMV', issueDate: addDays(T(600), -2922),
        fullName: 'Alex Morgan', licenseClass: 'D', restrictions: 'Corrective lenses', dateOfBirth: '1984-04-12',
      },
    }),
  );
  const cid = assign(cityId, 'person', maya.id, T(300));
  tx.put(
    makeDocument({
      category: 'identity', subjectId: maya.id, title: 'Maya’s city ID', type: 'City or state ID',
      files: files(idFrontImg, idBackImg), assignmentId: cid.a.id, expiry: { validUntil: T(300), outdated: false },
      fields: {
        idNumber: '552011870', issuer: 'City of New York', issueDate: addDays(T(300), -1826),
        fullName: 'Maya Morgan', dateOfBirth: '1985-09-30',
      },
    }),
  );

  // Treatment history
  const hd = (who: typeof alex, name: string, type: string, date: string, providerId: string | null, about: string, episode = '', pinned = false) => {
    if (providerId) link(providerId, who.id);
    return tx.put(makeDocument({
      category: 'health', subjectId: who.id, title: name, type, date, pinned,
      fields: { ...(providerId ? { providerId } : {}), ...(about ? { about } : {}), ...(episode ? { episode } : {}) },
    }));
  };
  hd(alex, 'Referral to orthopedics', 'Referral', T(-62), doctor.id, 'Left knee pain after running, three weeks', 'Knee injury');
  hd(alex, 'MRI report, left knee', 'Imaging', T(-48), lab.id, 'Mild meniscus strain, no tear', 'Knee injury');
  hd(alex, 'Orthopedist summary', 'Visit summary', T(-30), ortho.id, 'Physical therapy for six weeks, then follow-up', 'Knee injury', true);
  hd(alex, 'Blood panel results', 'Result', T(-170), lab.id, 'Cholesterol slightly high, recheck in six months');
  hd(noa, 'Inhaler prescription', 'Prescription', T(-200), pediatrician.id, 'Rescue inhaler as needed');
  hd(noa, 'Asthma action plan', 'Other', T(-200), pediatrician.id, 'What to do during a flare-up. A copy is at school.', '', true);
  hd(maya, 'Allergy prescription', 'Prescription', T(-90), doctor.id, 'Daily antihistamine in spring');

  // Car documents
  const cd = (car: typeof civic, name: string, type: string, validUntil: string | null, assignmentId: string | null, pinned: boolean) =>
    tx.put(makeDocument({
      category: 'car', subjectId: car.id, title: name, type, assignmentId, pinned,
      expiry: validUntil ? { validUntil, outdated: false } : null,
    }));
  cd(civic, 'Insurance card', 'ID card', T(45), civicIns.a.id, true);
  cd(civic, 'Registration', 'Registration', T(150), civicReg.a.id, true);
  cd(civic, 'Inspection report', 'Inspection', T(10), civicInsp.a.id, false);
  cd(yaris, 'Insurance card', 'ID card', T(120), yarisIns.a.id, true);
  cd(yaris, 'Registration', 'Registration', T(20), yarisReg.a.id, true);
  cd(yaris, 'Purchase receipt', 'Receipt', null, null, false);

  // ── Trips ──
  const trip = (name: string, destination: string, start: string, end: string, travelers: string[], notes: string) =>
    tx.put(makeSubject({ subjectType: 'trip', name, notes, attributes: { destination, start, end, travelers } }));
  const lisbon = trip('Lisbon and Sintra', 'Portugal', T(21), T(28), [alex.id, maya.id, noa.id, ben.id], 'Kids’ spring break');
  type ResInput = {
    subjectId: string; type: Reservation['type']; title: string; start: string; end: string | null;
    status?: Reservation['status']; bookBy?: string | null; checkinReminder?: boolean;
    address?: string; confirmation?: string; link?: string; details?: string; files?: FileRef[];
  };
  const res = (p: ResInput) => {
    const r = tx.put(
      makeReservation({
        subjectId: p.subjectId, type: p.type, title: p.title, start: p.start, end: p.end,
        status: p.status ?? 'booked', bookBy: p.bookBy ?? null, checkinReminder: p.checkinReminder ?? false,
        fields: Object.fromEntries(
          (['address', 'confirmation', 'link', 'details'] as const).filter((k) => p[k]).map((k) => [k, p[k]!]),
        ),
      }),
    );
    syncTripTasks(tx, r);
    // Reservation files are attachment documents of the trip.
    for (const f of p.files ?? []) {
      tx.put(makeDocument({
        category: 'attachment', type: 'File', subjectId: p.subjectId, title: f.name,
        attachedTo: { kind: 'reservation', id: r.id }, files: [{ role: null, file: f }],
      }) as Document);
    }
    return r;
  };
  const base = { subjectId: lisbon.id };
  res({ ...base, type: 'flight', title: 'TAP 202 · Newark to Lisbon', start: DT(21, '19:30'), end: DT(22, '07:10'), address: 'Newark Liberty, Terminal B', confirmation: 'XK7P2Q', files: [boarding], checkinReminder: true, details: 'Seats 23A–D. One checked bag each.' });
  res({ ...base, type: 'stay', title: 'Hotel Baixa Boutique', start: DT(22, '14:00'), end: DT(25, '11:00'), address: 'Rua Augusta 100, Lisbon', confirmation: 'HB-55821', link: 'https://www.booking.com/hotel/pt/baixa-boutique.html', details: 'Family room, breakfast included.' });
  res({ ...base, type: 'other', title: 'Dinner at Taberna da Rua', start: DT(22, '20:00'), end: null, address: 'Rua das Flores 32, Lisbon', details: 'Table for 4, ask for the terrace.' });
  res({ ...base, type: 'car', title: 'Compact SUV rental', start: DT(25, '10:00'), end: DT(28, '09:00'), address: 'Avenida da Liberdade 210, Lisbon', confirmation: 'EU-7731', details: 'Two child seats requested.' });
  res({ ...base, type: 'stay', title: 'Quinta guesthouse in Sintra', start: DT(25, '15:00'), end: DT(28, '08:00'), address: 'Rua Visconde de Monserrate, Sintra', status: 'planned', bookBy: T(5), link: 'https://www.airbnb.com/' });
  res({ ...base, type: 'activity', title: 'Pena Palace tickets', start: DT(26, '10:00'), end: DT(26, '13:00'), address: 'Estrada da Pena, Sintra', confirmation: 'PENA-3341', files: [pena], link: 'https://www.parquesdesintra.pt/' });
  res({ ...base, type: 'hike', title: 'Sintra ridge loop', start: DT(27, '09:00'), end: DT(27, '13:00'), address: 'Trailhead at Monserrate parking', status: 'planned', link: 'https://www.alltrails.com/trail/portugal/lisboa/sintra-ridge-loop' });
  res({ ...base, type: 'flight', title: 'TAP 201 · Lisbon to Newark', start: DT(28, '12:15'), end: DT(28, '15:20'), address: 'Lisbon Humberto Delgado, Terminal 1', confirmation: 'XK7P2Q', checkinReminder: true });

  const boston = trip('Boston long weekend', 'Massachusetts', T(-60), T(-57), [alex.id, maya.id], '');
  res({ subjectId: boston.id, type: 'train', title: 'Acela to Boston', start: DT(-60, '08:00'), end: DT(-60, '11:45'), address: 'Penn Station', confirmation: 'AM-20931' });
  res({ subjectId: boston.id, type: 'stay', title: 'Harborview Inn', start: DT(-60, '15:00'), end: DT(-57, '11:00'), address: '12 Atlantic Ave, Boston', confirmation: 'HVI-4410' });

  // ── General tasks ──
  const g = (title: string, date: string, notes = '', subtasks: string[] = []) => {
    const parent = tx.put(makeTask({ title, date, notes }));
    subtasks.forEach((t, i) =>
      tx.put(makeTask({
        title: t, parentId: parent.id, subjectId: null, order: i + 1, date: i === 2 ? T(10) : null,
        done: i === 0, doneAt: i === 0 ? new Date().toISOString() : null,
      })),
    );
    return parent;
  };
  g('Pay property tax', T(-3), 'Second installment');
  g('Call the plumber', T(0), 'Kitchen sink drips');
  g('Renew gym membership', T(9));
  g('Book flights for the holiday', T(16), '', ['Agree on dates with the grandparents', 'Compare fares', 'Check everyone’s passport dates', 'Book seats together']);

  return tx.changes();
}

export async function loadDemoData(s: CooState, apply: (cs: ChangeSet) => void) {
  apply(await buildDemo(s));
}
