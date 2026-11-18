import { useState } from 'react';
import type { Contact } from '../types/coo';

type ContactGroup = 'health' | 'cars' | 'other';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { useToast } from '../store/Toast';
import { copyText } from '../lib/clipboard';
import { Dialog, Empty, Field, FormActions, PageHead, SectionHead } from '../components/ui';
import { Icon } from '../components/Icon';
import { deleteContact, makeContact, putEntity } from '../lib/ops';
import { allSubjects, contactGroup, routineOf, subjectName } from '../lib/model';

const GROUPS: { value: ContactGroup; label: string }[] = [
  { value: 'health', label: 'Health' },
  { value: 'cars', label: 'Cars' },
  { value: 'other', label: 'Other' },
];

export function ContactDialog({ contact }: { contact?: Contact }) {
  const { s, apply } = useStore();
  const { closeDialog } = useUI();
  const [name, setName] = useState(contact?.name ?? '');
  const [role, setRole] = useState(contact?.role ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [group, setGroup] = useState<ContactGroup>(contact ? contactGroup(contact) : 'health');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [notes, setNotes] = useState(contact?.notes ?? '');
  const [linked, setLinked] = useState<string[]>(contact?.links.map((l) => l.subjectId) ?? []);
  const submit = () => {
    if (!name.trim() || !phone.trim()) return;
    // The group is the contact's first tag; other tags are kept.
    const others = (contact?.tags ?? []).filter((t) => !['health', 'cars', 'other'].includes(t));
    const links = linked.map((id) => contact?.links.find((l) => l.subjectId === id) ?? { subjectId: id, role: role.trim() });
    const data = { name: name.trim(), role: role.trim(), phone: phone.trim(), email: email.trim(), notes: notes.trim(), tags: [group, ...others], links };
    apply(putEntity(s, contact ? { ...contact, ...data } : makeContact(data)), { toast: contact ? 'Contact saved' : 'Contact added' });
    closeDialog();
  };
  return (
    <Dialog
      eyebrow="Shared contacts"
      title={contact ? `Edit ${contact.name}` : 'Add a contact'}
      onSubmit={submit}
      destructive={
        contact && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              apply(deleteContact(s, contact), { toast: `Deleted ${contact.name}`, undo: true });
              closeDialog();
            }}
          >
            Delete
          </button>
        )
      }
      actions={<FormActions submit={contact ? 'Save' : 'Add contact'} />}
    >
      <div className="fields">
        <Field label="Name">{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
        <Field label="Role" optional>{(id) => <input id={id} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Pediatrician" />}</Field>
      </div>
      <div className="fields">
        <Field label="Phone">{(id) => <input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />}</Field>
        <Field label="Group">
          {(id) => (
            <select id={id} value={group} onChange={(e) => setGroup(e.target.value as ContactGroup)}>
              {GROUPS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label="Email" optional>{(id) => <input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <Field label="Notes" optional>{(id) => <textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      <Field label="For" optional hint="Who or what this contact serves.">
        {(id) => (
          <div className="check-list" id={id} role="group" aria-label="For">
            {allSubjects(s).map((x) => (
              <label key={x.id} className="check-row">
                <input
                  type="checkbox"
                  checked={linked.includes(x.id)}
                  onChange={(e) => setLinked((cur) => (e.target.checked ? [...cur, x.id] : cur.filter((i) => i !== x.id)))}
                />
                <span>{x.name}</span>
              </label>
            ))}
          </div>
        )}
      </Field>
    </Dialog>
  );
}

function ContactTile({ c }: { c: Contact }) {
  const { s } = useStore();
  const { openDialog } = useUI();
  const toast = useToast();
  const used = s.assignments
    .filter((a) => a.contactId === c.id)
    .map((a) => `${subjectName(s, a.subjectId)} · ${routineOf(s, a)?.title ?? ''}`);
  return (
    <div className="tile contact-tile">
      <div className="contact-head">
        <div>
          <div className="tile-title">{c.name}</div>
          {c.role && <div className="muted small">{c.role}</div>}
        </div>
        <button type="button" className="btn ghost small" onClick={() => openDialog(<ContactDialog contact={c} />)}>
          Edit
        </button>
      </div>
      <div className="phone">{c.phone}</div>
      {c.email && <div className="small">{c.email}</div>}
      {c.notes && <div className="small">{c.notes}</div>}
      {c.links.length > 0 && <div className="muted small">For: {c.links.map((l) => subjectName(s, l.subjectId)).join(', ')}</div>}
      {used.length > 0 && <div className="muted small">Used for: {used.join(', ')}</div>}
      <div className="contact-actions">
        <a className="btn primary small" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>
          <Icon name="phone" size={16} /> Call
        </a>
        <button
          type="button"
          className="btn secondary small"
          onClick={() => copyText(c.phone).then((ok) => toast.show({ text: ok ? `Copied ${c.phone}` : 'Couldn’t copy. Select the text instead.' }))}
        >
          <Icon name="copy" size={16} /> Copy number
        </button>
      </div>
    </div>
  );
}

export default function Contacts() {
  const { s } = useStore();
  const { openDialog } = useUI();
  return (
    <div className="page">
      <PageHead
        eyebrow="Shared by everyone and every car"
        title="Contacts"
        actions={
          <button type="button" className="btn primary" onClick={() => openDialog(<ContactDialog />)}>
            <Icon name="plus" /> Add contact
          </button>
        }
      />
      {GROUPS.map((g) => {
        const list = s.contacts.filter((c) => contactGroup(c) === g.value).sort((a, b) => a.name.localeCompare(b.name));
        return (
          <section key={g.value} className="section">
            <SectionHead title={g.label} count={list.length} />
            {list.length === 0 ? (
              <Empty>No {g.label.toLowerCase()} contacts yet.</Empty>
            ) : (
              <div className="card-grid">
                {list.map((c) => (
                  <ContactTile key={c.id} c={c} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
