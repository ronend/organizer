import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Fields, Subject, SubjectType } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { useToast } from '../store/Toast';
import { Dialog, Field, FormActions } from '../components/ui';
import { Icon } from '../components/Icon';
import { FieldsEditor, fieldProblems } from '../components/FieldInputs';
import { deleteSubject, makeSubject, putEntity } from '../lib/ops';
import { subjectPath, subjectsOfType } from '../lib/model';
import { SUBJECT_TYPES, compactFields } from '../lib/registry';
import { SIDEBAR_TYPES } from '../components/Shell';
import { RoutineFormDialog } from './RoutineForm';

const BLURB: Partial<Record<SubjectType, string>> = {
  person: 'Health, IDs and renewals',
  car: 'Insurance, inspection and documents',
};

/**
 * Add or edit any subject: its name plus the attributes its type defines in
 * the registry (a car's plate and odometer, ...). New types need no code here.
 */
export function SubjectDialog({ subjectType, sub }: { subjectType: SubjectType; sub?: Subject }) {
  const { s, apply } = useStore();
  const { closeDialog, openDialog } = useUI();
  const toast = useToast();
  const navigate = useNavigate();
  const info = SUBJECT_TYPES[subjectType];
  const [name, setName] = useState(sub?.name ?? '');
  const [attributes, setAttributes] = useState<Fields>(sub?.attributes ?? {});
  const label = info.label.toLowerCase();

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    const siblings = subjectsOfType(s, subjectType).filter((x) => x.id !== sub?.id);
    if (siblings.some((x) => x.name.toLowerCase() === n.toLowerCase()) && subjectType === 'person') {
      toast.show({ text: 'Someone with that name already exists' });
      return;
    }
    const attrs = compactFields(attributes);
    const problems = fieldProblems(info.attributes, attrs, siblings.map((x) => x.attributes));
    if (problems.length) {
      toast.show({ text: problems[0] });
      return;
    }
    if (sub) {
      apply(putEntity(s, { ...sub, name: n, attributes: attrs }), { toast: 'Saved' });
      closeDialog();
      return;
    }
    const created = makeSubject({ subjectType, name: n, notes: '', attributes: attrs });
    apply(putEntity(s, created), { toast: `Added ${n}` });
    navigate(subjectPath(created));
    const area = info.routineAreas[0];
    if (area) openDialog(<RoutineFormDialog preselect={created.id} area={area} />);
    else closeDialog();
  };

  return (
    <Dialog
      eyebrow={sub ? info.label : `New ${label}`}
      title={sub ? `Edit ${sub.name}` : `Add a ${label}`}
      onSubmit={submit}
      destructive={
        sub && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              apply(deleteSubject(s, sub.id), { toast: `Removed ${sub.name}`, undo: true });
              closeDialog();
              navigate('/');
            }}
          >
            Delete
          </button>
        )
      }
      actions={<FormActions submit={sub ? 'Save' : `Add ${label}`} />}
    >
      <Field label={info.nameLabel}>
        {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder={info.namePlaceholder} required />}
      </Field>
      <FieldsEditor s={s} defs={info.attributes.filter((d) => !d.deprecated)} values={attributes} onChange={setAttributes} />
    </Dialog>
  );
}

/** "+" on mobile: choose what to add first. */
export function SubjectChooser() {
  const { openDialog } = useUI();
  return (
    <Dialog eyebrow="New" title="What would you like to add?">
      <div className="chooser">
        {SIDEBAR_TYPES.map((t) => (
          <button key={t} type="button" className="tile chooser-tile" onClick={() => openDialog(<SubjectDialog subjectType={t} />)}>
            <Icon name={SUBJECT_TYPES[t].icon} size={22} />
            <span className="tile-title">{SUBJECT_TYPES[t].label}</span>
            {BLURB[t] && <span className="muted">{BLURB[t]}</span>}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
