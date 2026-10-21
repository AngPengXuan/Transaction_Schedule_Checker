import { lockActionText } from '../../core/protocols/twopl';
import type { LockAction } from '../../core/protocols/twopl';
import { opText, txnName } from '../../core/schedule';
import type { Op, Schedule } from '../../core/schedule';

interface Props {
  schedule: Schedule;
  plan: LockAction[];
  highlight: Set<number>;
}

type Row = { at: number; txn: number; op?: Op; action?: LockAction };

/**
 * The schedule with one valid set of lock actions woven in, one column per
 * transaction: l-S / l-X before use, an upgrade where a read lock becomes a
 * write lock, u after the last use, and each transaction's lock point.
 */
export function LockPlanGrid({ schedule, plan, highlight }: Props) {
  const rows: Row[] = [
    ...schedule.ops.map((op) => ({ at: op.index, txn: op.txn, op })),
    ...plan.map((action) => ({ at: action.at, txn: action.txn, action })),
  ].sort((a, b) => a.at - b.at);

  return (
    <table className="schedule-grid lock-plan">
      <thead>
        <tr>
          <th className="step">#</th>
          {schedule.txns.map((t) => (
            <th key={t}>{txnName(t)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr
            key={i}
            className={`${r.op && highlight.has(r.op.index) ? 'lit' : ''} ${r.action ? `lock-row ${r.action.kind}` : ''}`}
          >
            <td className="step">{r.op ? r.op.index + 1 : ''}</td>
            {schedule.txns.map((t) => (
              <td key={t} className={t === r.txn && r.op ? `op op-${r.op.kind}` : ''}>
                {t !== r.txn ? '' : r.op ? opText(r.op) : lockActionText(r.action!)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
