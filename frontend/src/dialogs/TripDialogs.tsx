import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Document, FileRef, Reservation, ReservationType, Subject } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { useToast } from '../store/Toast';
import { copyText } from '../lib/clipboard';
import { uploadFile } from '../api/client';
import { Chips, Dialog, Field, FileImage, Fieldset, FormActions, StatusText, Viewer, isImage, useBusy } from '../components/ui';
import { Icon } from '../components/Icon';
import { addDays, datePart, fmtDate, fmtDateTime, timePart, today } from '../lib/dates';
import { attachmentsOf, findSubject, sortedPeople, tripInfo } from '../lib/model';
import { RES_ORDER, RES_TYPES, cleanLink, mapsUrl, resField, siteName } from '../lib/reservations';
import { compactFields } from '../lib/registry';
import { deleteReservation, deleteTrip, makeDocument, makeReservation, makeSubject, saveReservation, saveTrip } from '../lib/ops';
import { getFileUrl } from '../lib/files';

/** A trip is a subject; its destination, dates and travelers are registry attributes. */
export function TripDialog({ trip }: { trip?: Subject }) {
  const { s, apply } = useStore();
  const { closeDialog } = useUI();
  const toast = useToast();
  const navigate = useNavigate();
  const info = trip ? tripInfo(trip) : null;
  const [name, setName] = useState(trip?.name ?? '');
  const [destination, setDestination] = useState(info?.destination ?? '');
  const [start, setStart] = useState(info?.start || addDays(today(), 30));
  const [end, setEnd] = useState(info?.end || addDays(today(), 37));
  const [travelers, setTravelers] = useState<Set<string>>(new Set(info?.travelers ?? []));
  const [notes, setNotes] = useState(trip?.notes ?? '');

  const submit = () => {
    if (!name.trim() || !start || !end) return;
    if (end < start) {
      toast.show({ text: 'The trip ends before it starts' });
      return;
    }
    const attributes = compactFields({ ...(trip?.attributes ?? {}), destination: destination.trim(), start, end, travelers: [...travelers] });
    const data = { name: name.trim(), notes: notes.trim(), attributes };
    if (trip) {
      apply(saveTrip(s, { ...trip, ...data }), { toast: 'Trip saved' });
      closeDialog();
    } else {
      const t = makeSubject({ subjectType: 'trip', ...data });
      apply(saveTrip(s, t), { toast: 'Trip created' });
      closeDialog();
      navigate(`/trips/${t.id}`);
    }
  };

  return (
    <Dialog
      eyebrow={trip ? 'Trip' : 'New trip'}
      title={trip ? `Edit ${trip.name}` : 'Plan a trip'}
      onSubmit={submit}
      destructive={
        trip && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              apply(deleteTrip(s, trip), { toast: `Deleted ${trip.name}`, undo: true });
              closeDialog();
              navigate('/trips');
            }}
          >
            Delete trip
          </button>
        )
      }
      actions={<FormActions submit={trip ? 'Save' : 'Create trip'} />}
    >
      <Field label="Trip name">{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} required placeholder="Lisbon and Sintra" />}</Field>
      <Field label="Destination" optional>{(id) => <input id={id} value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Portugal" />}</Field>
      <div className="fields">
        <Field label="Starts">{(id) => <input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} required />}</Field>
        <Field label="Ends">{(id) => <input id={id} type="date" value={end} onChange={(e) => setEnd(e.target.value)} required />}</Field>
      </div>
      <Fieldset legend="Who is going">
        {sortedPeople(s).length === 0 ? (
          <div className="muted">Add people first to track their passports.</div>
        ) : (
          <div className="checklist">
            {sortedPeople(s).map((p) => (
              <label key={p.id} className="check-row">
                <input
                  type="checkbox"
                  checked={travelers.has(p.id)}
                  onChange={() =>
                    setTravelers((cur) => {
                      const n = new Set(cur);
                      if (n.has(p.id)) n.delete(p.id);
                      else n.add(p.id);
                      return n;
                    })
                  }
                />
                <span>{p.name}</span>
              </label>
            ))}
          </div>
        )}
      </Fieldset>
      <Field label="Notes" optional>{(id) => <textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
    </Dialog>
  );
}

export function ReservationFormDialog({
  tripId,
  reservation,
  initialStart,
  forceBooked,
  closeTaskId,
}: {
  tripId: string;
  reservation?: Reservation;
  initialStart?: string;
  forceBooked?: boolean;
  closeTaskId?: string;
}) {
  const { s, apply } = useStore();
  const { closeDialog } = useUI();
  const toast = useToast();
  const { busy, run } = useBusy();
  const trip = findSubject(s, tripId);
  const r = reservation;
  // Ticket files are attachment documents of the trip, attached to the reservation.
  const existing: Document[] = r ? attachmentsOf(s, 'reservation', r.id) : [];
  const [type, setType] = useState<ReservationType>(r?.type ?? 'flight');
  const [title, setTitle] = useState(r?.title ?? '');
  const [start, setStart] = useState(r?.start ?? initialStart ?? `${(trip && tripInfo(trip).start) || today()}T09:00`);
  const [end, setEnd] = useState(r?.end ?? '');
  const [address, setAddress] = useState(r ? resField(r, 'address') : '');
  const [confirmation, setConfirmation] = useState(r ? resField(r, 'confirmation') : '');
  const [link, setLink] = useState(r ? resField(r, 'link') : '');
  const [keep, setKeep] = useState<Document[]>(existing);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<'booked' | 'planned'>(forceBooked ? 'booked' : r?.status ?? 'booked');
  const [bookBy, setBookBy] = useState(r?.bookBy ?? '');
  const [details, setDetails] = useState(r ? resField(r, 'details') : '');
  const [checkin, setCheckin] = useState(r?.checkinReminder ?? true);
  const meta = RES_TYPES[type];

  const submit = () =>
    run(async () => {
      if (!title.trim() || !start) return;
      if (end && end < start) {
        toast.show({ text: `The ${meta.end.toLowerCase()} is before the ${meta.start.toLowerCase()}` });
        return;
      }
      let uploaded: FileRef[] = [];
      try {
        uploaded = await Promise.all(newFiles.map((f) => uploadFile(f, f.name)));
      } catch (e) {
        toast.show({ text: `Upload failed: ${e instanceof Error ? e.message : 'error'}` });
        return;
      }
      const data = {
        subjectId: tripId,
        type,
        title: title.trim(),
        start,
        end: end || null,
        status,
        bookBy: status === 'planned' && bookBy ? bookBy : null,
        checkinReminder: type === 'flight' ? checkin : false,
        fields: compactFields({ address: address.trim(), confirmation: confirmation.trim(), link: cleanLink(link), details: details.trim() }),
      };
      const res = r ? { ...r, ...data } : makeReservation(data);
      const attachments = uploaded.map((f) =>
        makeDocument({
          category: 'attachment', type: 'File', subjectId: tripId, title: f.name,
          attachedTo: { kind: 'reservation', id: res.id }, files: [{ role: null, file: f }],
        }),
      );
      const removeAttachments = existing.filter((d) => !keep.some((k) => k.id === d.id));
      apply(saveReservation(s, res, { closeTaskId, attachments, removeAttachments }), { toast: r ? 'Reservation saved' : 'Reservation added' });
      closeDialog();
    });

  return (
    <Dialog
      eyebrow={trip ? `${trip.name} · Reservation` : 'Reservation'}
      title={r ? `Edit ${r.title}` : 'Add a reservation'}
      wide
      onSubmit={submit}
      actions={<FormActions submit={busy ? 'Saving…' : 'Save reservation'} disabled={busy} />}
    >
      <Field label="Type">
        {() => (
          <Chips label="Type" value={type} onChange={setType} options={RES_ORDER.map((t) => ({ value: t, label: RES_TYPES[t].label, icon: RES_TYPES[t].icon }))} />
        )}
      </Field>
      <Field label="Title">{(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} required placeholder={meta.placeholder} />}</Field>
      <div className="fields">
        <Field label={meta.start}>{(id) => <input id={id} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />}</Field>
        <Field label={meta.end} optional>{(id) => <input id={id} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
      </div>
      <Field label={meta.address} optional>{(id) => <input id={id} value={address} onChange={(e) => setAddress(e.target.value)} placeholder={meta.addressPlaceholder} />}</Field>
      <div className="fields">
        <Field label="Confirmation or order number" optional>{(id) => <input id={id} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />}</Field>
        <Field label={type === 'hike' ? 'Link (an AllTrails trail, for example)' : 'Link'} optional>
          {(id) => <input id={id} value={link} onChange={(e) => setLink(e.target.value)} inputMode="url" placeholder={type === 'hike' ? 'alltrails.com/trail/…' : 'https://'} />}
        </Field>
      </div>
      <Field label="Tickets and confirmations" optional hint="PDFs or images. You can pick several.">
        {(id) => (
          <>
            {existing.length > 0 && (
              <div className="file-list">
                {existing.map((d) => (
                  <label key={d.id} className="check-row">
                    <input
                      type="checkbox"
                      checked={!keep.some((k) => k.id === d.id)}
                      onChange={(e) => setKeep((cur) => (e.target.checked ? cur.filter((k) => k.id !== d.id) : [...cur, d]))}
                    />
                    <span>Remove {d.title}</span>
                  </label>
                ))}
              </div>
            )}
            <input id={id} type="file" accept="application/pdf,image/*" multiple onChange={(e) => setNewFiles([...(e.target.files ?? [])])} />
          </>
        )}
      </Field>
      <Fieldset legend="Status">
        <label className="check-row">
          <input type="radio" name="res-status" checked={status === 'booked'} onChange={() => setStatus('booked')} />
          <span>Booked</span>
        </label>
        <label className="check-row">
          <input type="radio" name="res-status" checked={status === 'planned'} onChange={() => setStatus('planned')} />
          <span>Planned, not booked yet</span>
        </label>
        {status === 'planned' && (
          <Field label="Book by" optional hint="Adds a “Book:” task to the agenda on that date.">
            {(id) => <input id={id} type="date" value={bookBy} onChange={(e) => setBookBy(e.target.value)} />}
          </Field>
        )}
      </Fieldset>
      <Field label="Details" optional>{(id) => <textarea id={id} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />}</Field>
      {type === 'flight' && (
        <label className="check-row">
          <input type="checkbox" checked={checkin} onChange={(e) => setCheckin(e.target.checked)} />
          <span>Remind me to check in online the day before</span>
        </label>
      )}
    </Dialog>
  );
}

export function ReservationDetailDialog({ reservationId }: { reservationId: string }) {
  const { s, apply } = useStore();
  const ui = useUI();
  const toast = useToast();
  const r = s.reservations.find((x) => x.id === reservationId);
  if (!r) return null;
  const trip = findSubject(s, r.subjectId);
  const meta = RES_TYPES[r.type];
  const address = resField(r, 'address');
  const confirmation = resField(r, 'confirmation');
  const link = resField(r, 'link');
  const details = resField(r, 'details');
  const files = attachmentsOf(s, 'reservation', r.id).flatMap((d) => d.files.map((f) => f.file));
  const when = r.end
    ? datePart(r.start) === datePart(r.end)
      ? `${fmtDateTime(r.start)}–${timePart(r.end)}`
      : `${fmtDateTime(r.start)} – ${fmtDateTime(r.end)}`
    : fmtDateTime(r.start);

  return (
    <Dialog
      eyebrow={`${trip?.name ?? 'Trip'} · ${meta.label}`}
      title={r.title}
      destructive={
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            apply(deleteReservation(s, r), { toast: `Deleted ${r.title}`, undo: true });
            ui.closeDialog();
          }}
        >
          Delete
        </button>
      }
      actions={
        <>
          <button type="button" className="btn secondary" onClick={() => ui.openDialog(<ReservationFormDialog tripId={r.subjectId} reservation={r} />)}>
            Edit
          </button>
          <button type="button" className="btn primary" onClick={() => ui.openViewer(<TicketViewer reservationId={r.id} />)}>
            Show tickets
          </button>
        </>
      }
    >
      <StatusText tone={r.status === 'booked' ? 'ok' : 'warn'} text={r.status === 'booked' ? 'Booked' : 'Planned, not booked yet'} />
      <dl className="kv">
        <dt>When</dt>
        <dd>{when}</dd>
        {address && (
          <>
            <dt>Where</dt>
            <dd>
              {address}{' '}
              <a className="link" href={mapsUrl(address)} target="_blank" rel="noreferrer noopener">
                Open in Maps
              </a>
            </dd>
          </>
        )}
        {confirmation && (
          <>
            <dt>Confirmation</dt>
            <dd>
              <span className="mono">{confirmation}</span>{' '}
              <button
                type="button"
                className="link"
                onClick={() => copyText(confirmation).then((ok) => toast.show({ text: ok ? `Copied ${confirmation}` : 'Couldn’t copy. Select the text instead.' }))}
              >
                Copy
              </button>
            </dd>
          </>
        )}
        {link && (
          <>
            <dt>Link</dt>
            <dd>
              <a className="link" href={link} target="_blank" rel="noreferrer noopener">
                {siteName(link)}
              </a>{' '}
              <span className="muted truncate">{link.length > 48 ? `${link.slice(0, 48)}…` : link}</span>
            </dd>
          </>
        )}
        {files.length > 0 && (
          <>
            <dt>Files</dt>
            <dd>{files.map((f) => f.name).join(', ')}</dd>
          </>
        )}
        {details && (
          <>
            <dt>Details</dt>
            <dd className="pre">{details}</dd>
          </>
        )}
        {r.status === 'planned' && r.bookBy && (
          <>
            <dt>Book by</dt>
            <dd>{fmtDate(r.bookBy)}</dd>
          </>
        )}
      </dl>
    </Dialog>
  );
}

/** White card in both themes so QR codes scan well. */
export function TicketViewer({ reservationId }: { reservationId: string }) {
  const { s } = useStore();
  const toast = useToast();
  const r = s.reservations.find((x) => x.id === reservationId);
  if (!r) return null;
  const meta = RES_TYPES[r.type];
  const confirmation = resField(r, 'confirmation');
  const address = resField(r, 'address');
  const files: FileRef[] = attachmentsOf(s, 'reservation', r.id).flatMap((d) => d.files.map((f) => f.file));
  return (
    <Viewer title={r.title} white>
      <div className="ticket-card">
        <div className="ticket-type">
          {meta.label} · {fmtDateTime(r.start)}
        </div>
        <h2 className="ticket-title">{r.title}</h2>
        {confirmation && (
          <div className="ticket-conf">
            <span className="ticket-conf-label">Confirmation</span>
            <span className="ticket-conf-value">{confirmation}</span>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => copyText(confirmation).then((ok) => toast.show({ text: ok ? `Copied ${confirmation}` : 'Couldn’t copy. Select the text instead.' }))}
            >
              <Icon name="copy" size={16} /> Copy
            </button>
          </div>
        )}
        {files.filter(isImage).map((f) => (
          <FileImage key={f.key} file={f} alt={f.name} className="ticket-image" />
        ))}
        {files
          .filter((f) => !isImage(f))
          .map((f) => (
            <button
              key={f.key}
              type="button"
              className="btn secondary"
              onClick={async () => {
                const url = await getFileUrl(f.key);
                if (url) window.open(url, '_blank', 'noopener');
              }}
            >
              <Icon name="document" /> Open {f.name}
            </button>
          ))}
        {files.length === 0 && !confirmation && <p className="ticket-muted">No tickets attached yet.</p>}
        {address && <p className="ticket-address">{address}</p>}
      </div>
    </Viewer>
  );
}
