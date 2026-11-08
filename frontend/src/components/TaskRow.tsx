import type { KeyboardEvent, PointerEvent } from 'react';
import type { Task } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { dueLabel, fmtDate } from '../lib/dates';
import { taskMeta } from '../lib/model';
import { Icon } from './Icon';
import { useCompleteTask } from '../dialogs/TaskFlows';
import { TaskDetailDialog } from '../dialogs/TaskDialogs';

/** Round 20 px checkbox with a 44 px touch area. */
export function TaskCheck({ task }: { task: Task }) {
  const complete = useCompleteTask();
  return (
    <button
      type="button"
      className={`check ${task.done ? 'checked' : ''}`}
      role="checkbox"
      aria-checked={task.done}
      aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`}
      onClick={() => complete(task)}
    >
      <span className="check-ring">{task.done && <Icon name="check" size={13} />}</span>
    </button>
  );
}

export function TaskRow({
  task,
  draggable,
  dragging,
  onGripDown,
  onGripKey,
  meta,
}: {
  task: Task;
  draggable?: boolean;
  dragging?: boolean;
  onGripDown?: (e: PointerEvent<HTMLButtonElement>) => void;
  onGripKey?: (e: KeyboardEvent<HTMLButtonElement>) => void;
  meta?: string;
}) {
  const { s } = useStore();
  const { openDialog } = useUI();
  const due = dueLabel(task.date);
  const right = task.done ? `Done ${task.doneAt ? fmtDate(task.doneAt.slice(0, 10), true) : ''}` : due.text;
  return (
    <li className={`row task-row ${task.done ? 'done' : ''} ${dragging ? 'dragging' : ''}`} data-task-id={task.id}>
      <TaskCheck task={task} />
      <button type="button" className="row-main row-body" onClick={() => openDialog(<TaskDetailDialog taskId={task.id} />)}>
        <span className="row-title">{task.title}</span>
        <span className="row-meta">{meta ?? taskMeta(s, task)}</span>
      </button>
      <span className={`row-right ${due.overdue && !task.done ? 'overdue' : ''}`}>{right}</span>
      {draggable ? (
        <button
          type="button"
          className="grip"
          aria-label={`Move: ${task.title}. Drag, or use the up and down arrow keys.`}
          onPointerDown={onGripDown}
          onKeyDown={onGripKey}
          data-grip={task.id}
        >
          <Icon name="grip" />
        </button>
      ) : (
        onGripDown !== undefined && <span className="grip-spacer" aria-hidden="true" />
      )}
    </li>
  );
}
