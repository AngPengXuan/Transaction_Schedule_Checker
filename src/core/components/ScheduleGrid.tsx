import type { Schedule } from '../schedule';
import { opText, txnName } from '../schedule';

interface Props {
  schedule: Schedule;
  highlight: Set<number>;
}

const STATUS_NOTE = { committed: '', aborted: 'aborts', active: 'no commit' } as const;

/** The textbook layout: time runs down, one column per transaction. */
export function ScheduleGrid({ schedule, highlight }: Props) {
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
            <td className="step">{op.index + 1}</td>
            {schedule.txns.map((t) => (
              <td key={t} className={t === op.txn ? `op op-${op.kind}` : ''}>
                {t === op.txn ? opText(op) : ''}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
