import { useMemo, useState } from 'react';
import { GraphView } from '../../core/components/GraphView';
import { simulate } from '../../core/protocols/lockSim';
import type { Policy } from '../../core/protocols/lockSim';
import { opText, txnName } from '../../core/schedule';
import type { Schedule } from '../../core/schedule';

interface Props {
  schedule: Schedule;
  onHover: (ops: number[] | null) => void;
}

const POLICIES: { id: Policy; label: string; rule: string }[] = [
  {
    id: 'detect',
    label: 'Detect deadlocks',
    rule: 'A refused request waits. When the wait-for graph gets a cycle, the youngest transaction on it is aborted.',
  },
  {
    id: 'wait-die',
    label: 'Wait-die',
    rule: 'An older requester waits for a younger holder; a younger requester dies (aborts) instead of waiting.',
  },
  {
    id: 'wound-wait',
    label: 'Wound-wait',
    rule: 'An older requester wounds (aborts) a younger holder and takes the lock; a younger requester waits.',
  },
];

const WAIT_LABELS = { wr: 'waits for' };

/**
 * The schedule run through a strict 2PL lock manager, request by request,
 * under the chosen way of handling conflicts.
 */
export function ReplayPanel({ schedule, onHover }: Props) {
  const [policy, setPolicy] = useState<Policy>('detect');
  const run = useMemo(() => simulate(schedule, policy), [schedule, policy]);
  const rule = POLICIES.find((p) => p.id === policy)!.rule;

  const outcome = [
    run.deadlocks.length > 0 &&
      `${run.deadlocks.length} deadlock${run.deadlocks.length === 1 ? '' : 's'} found`,
    run.aborted.length > 0 && `${run.aborted.map(txnName).join(', ')} aborted by the lock manager`,
    run.stuck.length > 0 && `${run.stuck.map(txnName).join(', ')} still waiting at the end`,
  ].filter(Boolean);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="section-head">Replay under strict 2PL</h2>
        <div className="segmented" role="group" aria-label="Conflict handling">
          {POLICIES.map((p) => (
            <button
              key={p.id}
              className={p.id === policy ? 'on' : ''}
              aria-pressed={p.id === policy}
              title={p.rule}
              onClick={() => setPolicy(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <p className="panel-text">
        The schedule is read as the order requests arrive. Each read needs a shared lock and each
        write an exclusive one, held until commit or abort; a transaction that has to wait queues
        its later operations. {rule} Timestamps are arrival order:{' '}
        {schedule.txns.map((t) => `ts(${txnName(t)}) = ${run.ts.get(t)}`).join(', ')}.
      </p>

      <p className="replay-outcome">
        {outcome.length > 0 ? `${outcome.join('; ')}.` : 'Every request was granted when it arrived.'}{' '}
        <span className="muted">Ran as:</span>{' '}
        <span className="mono">{run.executed.map(opText).join(' ')}</span>
      </p>

      <table className="replay-log">
        <thead>
          <tr>
            <th>Step</th>
            <th>What happens</th>
          </tr>
        </thead>
        <tbody>
          {run.events.map((e, i) => (
            <tr
              key={i}
              className={`ev-${e.kind}`}
              onMouseEnter={() => onHover(e.ops)}
              onMouseLeave={() => onHover(null)}
            >
              <td className="step">{e.step < schedule.ops.length ? e.step + 1 : 'end'}</td>
              <td>{e.text}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {run.deadlocks.length > 0 && (
        <>
          <h3 className="sub-head">Wait-for graph when the deadlock was found</h3>
          <div className="graph-grid">
            {run.deadlocks.map((d, i) => (
              <div key={i} className="graph-card cyclic">
                <GraphView nodes={d.nodes} edges={d.edges} cycle={d.cycle} compact labels={WAIT_LABELS} />
                <p className="graph-verdict no">
                  At step {d.step + 1}: cycle {d.cycle.map(txnName).join(' → ')}; {txnName(d.victim)} aborted
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
