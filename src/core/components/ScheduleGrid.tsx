import type { Op, Schedule } from '../schedule';
import { opText, txnName } from '../schedule';

interface Props {
  schedule: Schedule;
  highlight: Set<number>;
  /** A short label after each operation, e.g. the database it runs at. */
  tag?: (op: Op) => string | null;
  /** The step number shown for an operation; defaults to its position in the schedule. */
  stepOf?: (op: Op) => number;
}

const STATUS_NOTE = { committed: '', aborted: 'aborts', active: 'no commit' } as const;

/** The textbook layout: time runs down, one column per transaction. */
export function ScheduleGrid({ schedule, highlight, tag, stepOf }: Props) {
  return (
    <table className="schedule-grid">
      <thead>
        <tr>
          <th className="step">#</th>
          {schedule.txns.map((t) => (
            <th key={t} className={schedule.status[t]}>
              {txnName(t)}
              {STATUS_NOTE[schedule.status[t]] && (
                <span className="txn-status">{STATUS_NOTE[schedule.status[t]]}</span>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {schedule.ops.map((op) => (
          <tr key={op.index} className={highlight.has(op.index) ? 'lit' : ''}>
            <td className="step">{stepOf ? stepOf(op) : op.index + 1}</td>
            {schedule.txns.map((t) => (
              <td key={t} className={t === op.txn ? `op op-${op.kind}` : ''}>
                {t === op.txn ? opText(op) : ''}
                {t === op.txn && tag?.(op) && <span className="op-tag-site">{tag(op)}</span>}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
