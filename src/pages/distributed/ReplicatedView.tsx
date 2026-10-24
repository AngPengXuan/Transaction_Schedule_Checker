import { useMemo, useState } from 'react';
import { EdgeRows, PropertyCard, Subset } from '../../core/components/Cards';
import { GraphView, Legend } from '../../core/components/GraphView';
import { ScheduleGrid } from '../../core/components/ScheduleGrid';
import { orderText } from '../../core/format';
import type { EdgeRule } from '../../core/graph';
import { T0, txnName } from '../../core/schedule';
import { analyseReplicated, parseLocalSchedules } from './replicated';
import { REP_DEFAULT, REP_PRESETS } from './replicatedPresets';

const RDSG_LABELS: Partial<Record<EdgeRule, string>> = {
  b: 'write order (chosen)',
  c: 'read order',
};

function conflictRules(edges: { rule: EdgeRule }[]): EdgeRule[] {
  return (['wr', 'rw', 'ww', 'b', 'c'] as EdgeRule[]).filter((r) => edges.some((e) => e.rule === r));
}

/** Replicated data: one local schedule per site, copies inferred from what each site mentions. */
export function ReplicatedView() {
  const [text, setText] = useState(REP_DEFAULT.schedules);
  const [preset, setPreset] = useState(REP_DEFAULT.id);
  const [hoverOps, setHoverOps] = useState<number[] | null>(null);

  const parsed = useMemo(() => parseLocalSchedules(text), [text]);
  const analysis = useMemo(
    () => (parsed.errors.length === 0 && parsed.sites.length > 0 ? analyseReplicated(parsed.sites) : null),
    [parsed],
  );
  const highlight = useMemo(() => new Set(hoverOps ?? []), [hoverOps]);

  function load(next: string, id = '') {
    setText(next);
    setPreset(id);
    setHoverOps(null);
  }

  return (
    <>
      <p className="subtitle">
        CS4224 — replicated databases. Each site runs its own local schedule, and an object may have
        a copy at several sites. Is each site serializable, is the whole execution one-copy
        serializable, and do the copies agree?
      </p>

      <section className="controls">
        <div className="control-group">
          <label htmlFor="rep-preset">Example</label>
          <select
            id="rep-preset"
            className="wide"
            value={preset}
            onChange={(e) => {
              const p = REP_PRESETS.find((x) => x.id === e.target.value);
              if (p) load(p.schedules, p.id);
            }}
          >
            <option value="" disabled>
              Custom
            </option>
            {REP_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="schedule-input">
          <label htmlFor="rep-schedules">Local schedules, one site per line</label>
          <textarea
            id="rep-schedules"
            rows={4}
            value={text}
            spellCheck={false}
            onChange={(e) => load(e.target.value)}
            placeholder={'S1: R1(X) W1(X) C1\nS2: W1(X) C1'}
          />
        </div>
        <p className="field-hint">
          Each line is <code>Site: operations</code>, e.g. <code>S1: R1(X) W2(X) C1 C2</code>. A
          site holds a copy of every object its schedule mentions. A transaction is the same
          transaction at every site; it counts as committed only if it commits at every site it
          ran at.
        </p>
      </section>

      {parsed.errors.length > 0 && (
        <div className="errors">
          {parsed.errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      {analysis && (
        <div className="layout">
          <aside className="side">
            <h2 className="section-head">Copies</h2>
            <table className="copy-table">
              <thead>
                <tr>
                  <th>Object</th>
                  <th>Writes at each copy</th>
                </tr>
              </thead>
              <tbody>
                {analysis.copies.map((row) => {
                  const finals = new Set(row.copies.map((c) => c.writers[c.writers.length - 1] ?? T0));
                  return (
                    <tr key={row.obj}>
                      <td className="obj">{row.obj}</td>
                      <td>
                        {row.copies.map((c) => (
                          <div key={c.site} className={finals.size > 1 ? 'diverges' : ''}>
                            {c.site}: {c.writers.length === 0 ? 'initial value' : c.writers.map(txnName).join(' → ')}
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="side-hint">
              Committed transactions only. Red: the copies end with different values.
            </p>
          </aside>

          <main className="main">
            <section className="chains">
              <div className="chain">
                <h2 className="section-head">One-copy serializability — strongest first</h2>
                <div className="chain-row two">
                  <PropertyCard
                    name="Acyclic RDSG"
                    rule="Some choice of write order makes the replicated data serialization graph acyclic."
                    verdict={analysis.rdsg}
                    onHover={setHoverOps}
                  />
                  <Subset title="An acyclic RDSG proves one-copy serializability" />
                  <PropertyCard
                    name="One-copy serializable (1SR)"
                    rule="Equivalent to a serial execution on a single copy of each object."
                    verdict={analysis.oneCopy}
                    onHover={setHoverOps}
                    impliedBy={analysis.rdsg.holds ? 'acyclic-RDSG' : undefined}
                  >
                    <p className="card-extra">Checked by trying every serial order.</p>
                  </PropertyCard>
                </div>
              </div>

              <div className="chain">
                <h2 className="section-head">Building blocks</h2>
                <div className="cards">
                  <PropertyCard
                    name="Each site serializable"
                    rule="Every local schedule is conflict serializable on its own."
                    verdict={analysis.localCss}
                    onHover={setHoverOps}
                  />
                  <PropertyCard
                    name="Union graph acyclic"
                    rule="One serial order is consistent with every site's conflicts."
                    verdict={analysis.union}
                    onHover={setHoverOps}
                  />
                  <PropertyCard
                    name="Read one, write all (ROWA)"
                    rule="Every write reaches every copy of its object."
                    verdict={analysis.rowa}
                    onHover={setHoverOps}
                  >
                    {analysis.rowa.holds && analysis.union.holds && (
                      <p className="card-implied">With ROWA, an acyclic union graph is enough for 1SR.</p>
                    )}
                  </PropertyCard>
                  <PropertyCard
                    name="Mutual consistency"
                    rule="Every copy of each object ends with the same final write."
                    verdict={analysis.mutual}
                    onHover={setHoverOps}
                  />
                  <PropertyCard
                    name="Atomic commit"
                    rule="Each transaction commits at every site it ran at, or aborts at all of them."
                    verdict={analysis.atomic}
                    onHover={setHoverOps}
                  />
                </div>
              </div>
            </section>

            <section className="panel">
              <h2 className="section-head">Each site on its own</h2>
              <div className="site-grid">
                {analysis.locals.map((l) => {
                  const offset = analysis.sites.find((s) => s.name === l.site)!.offset;
                  return (
                    <div key={l.site} className="site-card">
                      <div className="site-head">
                        <span className="site-name">{l.site}</span>
                        <span className="site-objects">{l.schedule.objects.join(', ')}</span>
                      </div>
                      <p className={`site-verdict ${l.css.holds ? 'yes' : 'no'}`}>
                        {l.css.holds
                          ? `✓ serializable${l.css.order && l.css.order.length > 0 ? `: ${orderText(l.css.order)}` : ''}`
                          : '✗ not serializable'}
                      </p>
                      <ScheduleGrid
                        schedule={l.schedule}
                        highlight={highlight}
                        stepOf={(op) => op.index - offset + 1}
                      />
                      <GraphView
                        nodes={l.css.graph.nodes}
                        edges={l.css.graph.edges}
                        cycle={l.css.cycle}
                        onHover={setHoverOps}
                        compact
                      />
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="panel">
              <h2 className="section-head">Union of the local graphs</h2>
              <p className="panel-text">
                Every conflict happens at one site, between operations on the same copy. The union
                of the sites&rsquo; graphs orders every pair of conflicting transactions.{' '}
                {analysis.union.summary}
              </p>
              <Legend rules={conflictRules(analysis.union.graph.edges)} />
              <div className="graph-with-list">
                <GraphView
                  nodes={analysis.union.graph.nodes}
                  edges={analysis.union.graph.edges}
                  cycle={analysis.union.cycle}
                  onHover={setHoverOps}
                />
                <EdgeRows edges={analysis.union.graph.edges} onHover={setHoverOps} />
              </div>
            </section>

            <section className="panel">
              <h2 className="section-head">Replicated data serialization graph (RDSG)</h2>
              <dl className="rule-list">
                <dt>Start with:</dt>
                <dd>The union of the local graphs.</dd>
                <dt>Write order:</dt>
                <dd>
                  Choose an order for each object&rsquo;s writers. A virtual Tf reads every copy&rsquo;s
                  final value, so each copy&rsquo;s last writer must come last.
                </dd>
                <dt>Read order:</dt>
                <dd>If Tj reads X from Ti, and Tk writes X after Ti in that order, add Tj → Tk.</dd>
              </dl>
              <p className="panel-text">{analysis.rdsg.summary}</p>
              {analysis.rdsg.writeOrder.length > 0 && (
                <ul className="write-order">
                  {analysis.rdsg.writeOrder.map((w) => (
                    <li key={w.obj}>
                      <span className="mono">{w.obj}</span>: {w.writers.map(txnName).join(' → ')}
                    </li>
                  ))}
                </ul>
              )}
              <Legend rules={conflictRules(analysis.rdsg.graph.edges)} labels={RDSG_LABELS} />
              <div className="graph-with-list">
                <GraphView
                  nodes={analysis.rdsg.graph.nodes}
                  edges={analysis.rdsg.graph.edges}
                  cycle={analysis.rdsg.cycle}
                  onHover={setHoverOps}
                  labels={RDSG_LABELS}
                />
                <EdgeRows edges={analysis.rdsg.graph.edges} onHover={setHoverOps} />
              </div>
            </section>
          </main>
        </div>
      )}
    </>
  );
}
