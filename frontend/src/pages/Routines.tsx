import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Empty, PageHead, SectionHead } from '../components/ui';
import { Icon } from '../components/Icon';
import { EditRoutineDialog, RoutineFormDialog } from '../dialogs/RoutineForm';
import { RoutineDetailDialog } from '../dialogs/RoutineDetail';
import { assignmentStatus, assignmentsOf, routineSummary, subjectName } from '../lib/model';
import { AREA_LABEL } from '../lib/templates';

export default function Routines() {
  const { s } = useStore();
  const { openDialog } = useUI();
  const list = [...s.routines].sort((a, b) => a.area.localeCompare(b.area) || a.title.localeCompare(b.title));
  return (
    <div className="page">
      <PageHead
        eyebrow="Create once, assign to people and cars"
        title="Routines"
        actions={
          <button type="button" className="btn primary" onClick={() => openDialog(<RoutineFormDialog />)}>
            <Icon name="plus" /> New routine
          </button>
        }
      />
      <section className="section">
        <SectionHead title="All routines" count={list.length} />
        {list.length === 0 ? (
          <Empty>No routines yet. Create one for a renewal, a checkup or a medication supply.</Empty>
        ) : (
          <ul className="list">
            {list.map((r) => (
              <li key={r.id} className="row routine-row">
                <Icon name={r.icon} />
                <div className="row-main">
                  <span className="row-title strong">{r.title}</span>
                  {r.description && <span className="row-desc">{r.description}</span>}
                  <span className="row-meta">
                    {routineSummary(r)} · {AREA_LABEL[r.area]}
                  </span>
                  <div className="chip-row">
                    {assignmentsOf(s, r).map((a) => {
                      const st = assignmentStatus(s, a);
                      return (
                        <button key={a.id} type="button" className="chip assignee" onClick={() => openDialog(<RoutineDetailDialog assignmentId={a.id} />)}>
                          <span className={`dot tone-${st.tone}`} aria-hidden="true" />
                          <strong>{subjectName(s, a.subjectId)}</strong>
                          <span className={`tone-${st.tone}`}>{st.text}</span>
                        </button>
                      );
                    })}
                    <button type="button" className="chip dashed" onClick={() => openDialog(<EditRoutineDialog routine={r} />)}>
                      + Assign
                    </button>
                  </div>
                </div>
                <button type="button" className="btn ghost small" onClick={() => openDialog(<EditRoutineDialog routine={r} />)}>
                  Edit
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
