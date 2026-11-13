import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Car, Person } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { useToast } from '../store/Toast';
import { Dialog, Field, FormActions } from '../components/ui';
import { Icon } from '../components/Icon';
import { deleteSubject, makeCar, makePerson, putEntity } from '../lib/ops';
import { subjectPath } from '../lib/model';
import { RoutineFormDialog } from './RoutineForm';

export function PersonDialog({ person }: { person?: Person }) {
  const { s, apply } = useStore();
  const { closeDialog, openDialog } = useUI();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(person?.name ?? '');

  const submit = () => {
    const n = name.trim();
    if (!n) return;
    if (s.people.some((p) => p.id !== person?.id && p.name.toLowerCase() === n.toLowerCase())) {
      toast.show({ text: 'Someone with that name already exists' });
      return;
    }
    if (person) {
      apply(putEntity(s, { ...person, name: n }), { toast: 'Saved' });
      closeDialog();
      return;
    }
    const p = makePerson(n, null);
    apply(putEntity(s, p), { toast: `Added ${n}` });
    navigate(subjectPath('person', p.id));
    openDialog(<RoutineFormDialog preselect={{ type: 'person', id: p.id }} area="health" />);
  };

  return (
    <Dialog
      eyebrow={person ? 'Person' : 'New person'}
      title={person ? `Edit ${person.name}` : 'Add a person'}
      onSubmit={submit}
      destructive={
        person && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              apply(deleteSubject(s, 'person', person.id), { toast: `Removed ${person.name}`, undo: true });
              closeDialog();
              navigate('/');
            }}
          >
            Delete
          </button>
        )
      }
      actions={<FormActions submit={person ? 'Save' : 'Add person'} />}
    >
      <Field label="Name">{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
    </Dialog>
  );
}

export function CarDialog({ car }: { car?: Car }) {
  const { s, apply } = useStore();
  const { closeDialog, openDialog } = useUI();
  const toast = useToast();
  const navigate = useNavigate();
  const [makeModel, setMakeModel] = useState(car?.makeModel ?? '');
  const [plate, setPlate] = useState(car?.plate ?? '');
  const [odo, setOdo] = useState(car?.odometer != null ? String(car.odometer) : '');

  const submit = () => {
    const mm = makeModel.trim();
    const pl = plate.trim().toUpperCase().replace(/\s+/g, ' ');
    if (!mm || !pl) return;
    if (s.cars.some((c) => c.id !== car?.id && c.plate.replace(/\s/g, '') === pl.replace(/\s/g, ''))) {
      toast.show({ text: 'A car with that plate already exists' });
      return;
    }
    const odometer = odo ? Number(odo) : null;
    if (car) {
      apply(putEntity(s, { ...car, makeModel: mm, plate: pl, odometer }), { toast: 'Saved' });
      closeDialog();
      return;
    }
    const c = makeCar(mm, pl, odometer);
    apply(putEntity(s, c), { toast: `Added ${mm}` });
    navigate(subjectPath('car', c.id));
    openDialog(<RoutineFormDialog preselect={{ type: 'car', id: c.id }} area="car" />);
  };

  return (
    <Dialog
      eyebrow={car ? 'Car' : 'New car'}
      title={car ? `Edit ${car.makeModel}` : 'Add a car'}
      onSubmit={submit}
      destructive={
        car && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              apply(deleteSubject(s, 'car', car.id), { toast: `Removed ${car.makeModel}`, undo: true });
              closeDialog();
              navigate('/');
            }}
          >
            Delete
          </button>
        )
      }
      actions={<FormActions submit={car ? 'Save' : 'Add car'} />}
    >
      <Field label="Make and model">
        {(id) => <input id={id} value={makeModel} onChange={(e) => setMakeModel(e.target.value)} placeholder="Honda Civic" required />}
      </Field>
      <div className="fields">
        <Field label="Plate number">
          {(id) => (
            <input
              id={id}
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="KDR 4821"
              required
              autoCapitalize="characters"
            />
          )}
        </Field>
        <Field label="Odometer" optional>
          {(id) => <input id={id} type="number" inputMode="numeric" min={0} value={odo} onChange={(e) => setOdo(e.target.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}

/** "+" on mobile: Person or Car first. */
export function SubjectChooser() {
  const { openDialog } = useUI();
  return (
    <Dialog eyebrow="New" title="Add a person or a car">
      <div className="chooser">
        <button type="button" className="tile chooser-tile" onClick={() => openDialog(<PersonDialog />)}>
          <Icon name="person" size={22} />
          <span className="tile-title">Person</span>
          <span className="muted">Health, IDs and renewals</span>
        </button>
        <button type="button" className="tile chooser-tile" onClick={() => openDialog(<CarDialog />)}>
          <Icon name="car" size={22} />
          <span className="tile-title">Car</span>
          <span className="muted">Insurance, inspection and documents</span>
        </button>
      </div>
    </Dialog>
  );
}
