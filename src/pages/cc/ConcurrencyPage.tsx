import { useMemo, useState } from 'react';
import { EdgeRows, PropertyCard, Subset } from '../../core/components/Cards';
import { GraphView, Legend } from '../../core/components/GraphView';
import { ScheduleGrid } from '../../core/components/ScheduleGrid';
import { ViewGraphPanel } from '../../core/components/ViewGraphPanel';
import { orderText } from '../../core/format';
import type { EdgeRule } from '../../core/graph';
import { parseSchedule, subscript } from '../../core/schedule';
import { strongerHolding } from '../../core/verdict';
import { useViewStyle } from '../../core/viewStyle';
import { analyseLocking } from './locking';
import { LockPlanGrid } from './LockPlanGrid';
import { analyseMv, withSnapshotVersions } from './multiversion';
import { CC_DEFAULT, CC_PRESETS, LOCK_PRESETS, MV_PRESETS } from './presets';
import { ReplayPanel } from './ReplayPanel';
import './ConcurrencyPage.css';

const DSG_LABELS: Partial<Record<EdgeRule, string>> = {
  wr: 'wr: reads that version',
  ww: 'ww: writes the next version',
  rw: 'rw: anti-dependency (overwrites the version read)',
};

/** A random schedule: half the time plain (for the locking checks), half with versions as SI would give them. */
function randomSchedule(): string {
  const n = 2 + Math.floor(Math.random() * 2);
  const objects = Math.random() < 0.5 ? ['A', 'B'] : ['A', 'B', 'C'];
  const queues = Array.from({ length: n }, (_, i) => {
    const t = i + 1;
    const q: string[] = [];
    const count = 2 + Math.floor(Math.random() * 2);
    for (let k = 0; k < count; k++) {
      const obj = objects[Math.floor(Math.random() * objects.length)];
      q.push(`${Math.random() < 0.55 ? 'R' : 'W'}${t}(${obj})`);
    }
    q.push(Math.random() < 0.9 ? `C${t}` : `A${t}`);
    return q;
  });
  const out: string[] = [];
  while (queues.some((q) => q.length > 0)) {
    const live = queues.filter((q) => q.length > 0);
    out.push(live[Math.floor(Math.random() * live.length)].shift()!);
  }
  if (Math.random() < 0.5) return out.join(' ');
  const plain = parseSchedule(out.join(' '), { versions: true }).schedule;
  return plain ? withSnapshotVersions(plain) : out.join(' ');
}

/** Concurrency control: locking (2PL, strict 2PL, deadlocks) and multiversion (MVSS, SI, SSI). */
export function ConcurrencyPage() {
  const [text, setText] = useState(CC_DEFAULT.schedule);
  const [preset, setPreset] = useState(CC_DEFAULT.id);
  const [hoverOps, setHoverOps] = useState<number[] | null>(null);
  const [style, setStyle] = useViewStyle();

  const parsed = useMemo(() => parseSchedule(text, { versions: true }), [text]);
  const schedule = parsed.schedule;
  const analysis = useMemo(() => (schedule ? analyseMv(schedule, style) : null), [schedule, style]);
  const locking = useMemo(
    () => (schedule && analysis ? analyseLocking(schedule, analysis.monoversion.holds) : null),
    [schedule, analysis],
  );
  const lockChain = locking
    ? [
        { short: 'strict 2PL', holds: locking.strict.holds },
        { short: '2PL', holds: locking.twoPl.holds },
        { short: 'CSS', holds: locking.css.holds },
      ]
    : [];
  const highlight = useMemo(() => new Set(hoverOps ?? []), [hoverOps]);

  function load(next: string, id = '') {
    setText(next);
    setPreset(id);
    setHoverOps(null);
  }

  const dsgRules = analysis
    ? (['wr', 'ww', 'rw'] as EdgeRule[]).filter((r) => analysis.dsg.graph.edges.some((e) => e.rule === r))
    : [];

  return (
    <>
      <p className="subtitle">
        CS3223 — how a scheduler would treat the schedule. Could two-phase locking or strict 2PL
        have produced it, and where would it deadlock? With multiple versions, where a read may
        see an older one: is it multiversion view serializable, would snapshot isolation allow it,
        and would serializable SI catch it?
      </p>

      <section className="controls">
        <div className="control-group">
          <label htmlFor="mv-preset">Example</label>
          <select
            id="mv-preset"
            className="wide"
            value={preset}
            onChange={(e) => {
              const p = CC_PRESETS.find((x) => x.id === e.target.value);
              if (p) load(p.schedule, p.id);
            }}
          >
            <option value="" disabled>
              Custom
            </option>
            <optgroup label="Locking">
              {LOCK_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Multiversion">
              {MV_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="control-group actions">
          <button className="ghost" onClick={() => load(randomSchedule())}>
            Random
          </button>
          <button
            className="ghost"
            disabled={!schedule}
            title="Rewrite every read to name the version snapshot isolation would give it"
            onClick={() => schedule && load(withSnapshotVersions(schedule))}
          >
            Fill SI versions
          </button>
        </div>
        <div className="schedule-input">
          <label htmlFor="mv-schedule">Schedule</label>
          <textarea
            id="mv-schedule"
            rows={2}
            value={text}
            spellCheck={false}
            onChange={(e) => load(e.target.value)}
            placeholder="R1,0(A) W2(A) C2 R1,0(B) C1"
          />
        </div>
        <p className="field-hint">
          Plain schedules (<code>R1(A) W2(A) C1</code>) work for everything. For multiversion
          checks, a read can name its version: <code>R1,2(A)</code> is T1 reading the version of A
          written by T2, shown as <code>R1(A₂)</code>; <code>R1,0(A)</code> reads the initial version. A
          plain <code>R1(A)</code> reads the latest earlier write. A transaction that has written
          A must read its own version. A transaction starts at its first operation; its snapshot
          is everything committed before then.
        </p>
      </section>

      {parsed.errors.length > 0 && (
        <div className="errors">
          {parsed.errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      {schedule && analysis && locking && (
        <div className="layout">
          <aside className="side">
            <h2 className="section-head">Schedule</h2>
            <ScheduleGrid schedule={schedule} highlight={highlight} />
            <p className="side-hint">Hover over an edge or a violation to light up its operations.</p>
            {analysis.notes.map((n, i) => (
              <p key={i} className="note">
                {n}
              </p>
            ))}
            <h2 className="section-head versions-head">Version order (commit order)</h2>
            {analysis.dsg.versionOrder.length === 0 ? (
              <p className="note">Nothing is written, so every object keeps its initial version.</p>
            ) : (
              <ul className="version-list">
                {analysis.dsg.versionOrder.map((v) => (
                  <li key={v.obj}>
                    <span className="mono">{v.obj}:</span>{' '}
                    {v.writers.map((w) => `${v.obj}${subscript(w)}`).join(' → ')}
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <main className="main">
            <h2 className="part-head">Locking</h2>
            <section className="chains">
              <div className="chain">
                <h2 className="section-head">Could locking have produced it? — strongest first</h2>
                <div className="chain-row">
                  <PropertyCard
                    name="Strict 2PL"
                    rule="2PL, and every lock held until the transaction commits or aborts."
                    verdict={locking.strict}
                    onHover={setHoverOps}
                  />
                  <Subset title="Every strict 2PL schedule is a 2PL schedule" />
                  <PropertyCard
                    name="Two-phase locking (2PL)"
                    rule="S lock to read, X lock to write, and no lock acquired after the first unlock."
                    verdict={locking.twoPl}
                    onHover={setHoverOps}
                    impliedBy={strongerHolding(lockChain, 1)}
                  />
                  <Subset title="Every 2PL schedule is conflict serializable" />
                  <PropertyCard
                    name="Conflict serializable (CSS)"
                    rule="The precedence graph of conflicts has no cycle."
                    verdict={locking.css}
                    onHover={setHoverOps}
                    impliedBy={strongerHolding(lockChain, 2)}
                  />
                </div>
              </div>
            </section>

            {locking.twoPl.plan && (
              <section className="panel">
                <h2 className="section-head">One way 2PL could have produced it</h2>
                <p className="panel-text">
                  Each transaction takes every lock before its lock point and releases every lock
                  after it. Locks here are taken as late and released as early as that allows.
                  {locking.strict.holds
                    ? ' Strict 2PL also works: hold every lock until commit instead.'
                    : ' Some unlock comes before its commit, so strict 2PL would not have allowed this.'}
                </p>
                <LockPlanGrid schedule={schedule} plan={locking.twoPl.plan} highlight={highlight} />
              </section>
            )}

            {locking.applicable && <ReplayPanel key={`replay-${text}`} schedule={schedule} onHover={setHoverOps} />}

            <h2 className="part-head">Multiple versions</h2>
            <section className="chains">
              <div className="chain">
                <h2 className="section-head">Serializability — strongest first</h2>
                <div className="chain-row two">
                  <PropertyCard
                    name="View serializable (VSS)"
                    rule="Monoversion, and view serializable as an ordinary schedule."
                    verdict={analysis.vss}
                    onHover={setHoverOps}
                  />
                  <Subset title="Every VSS schedule is MVSS" />
                  <PropertyCard
                    name="Multiversion view serializable (MVSS)"
                    rule="Some serial monoversion schedule has the same reads-from."
                    verdict={analysis.mvss}
                    onHover={setHoverOps}
                    impliedBy={analysis.vss.holds ? 'VSS' : undefined}
                  >
                    {analysis.mvss.serialOrders && (
                      <p className="card-extra">
                        Checked by trying all serial orders:{' '}
                        {analysis.mvss.serialOrders.length === 0
                          ? 'none has the same reads-from.'
                          : `same reads-from as ${analysis.mvss.serialOrders.map(orderText).join(', ')}.`}
                      </p>
                    )}
                  </PropertyCard>
                </div>
              </div>

              <div className="chain">
                <h2 className="section-head">Versions</h2>
                <div className="cards">
                  <PropertyCard
                    name="Monoversion"
                    rule="Every read sees the latest earlier write."
                    verdict={analysis.monoversion}
                    onHover={setHoverOps}
                  />
                  <PropertyCard
                    name="Serialization graph acyclic"
                    rule="wr, ww and rw edges, with versions ordered by commit; see below."
                    verdict={analysis.dsg}
                    onHover={setHoverOps}
                  />
                </div>
              </div>

              <div className="chain">
                <h2 className="section-head">Snapshot isolation</h2>
                <div className="cards">
                  <PropertyCard
                    name="Snapshot reads"
                    rule="Each read sees its own write, or the latest version committed before its transaction started."
                    verdict={analysis.snapshotReads}
                    onHover={setHoverOps}
                  />
                  <PropertyCard
                    name="First-committer-wins"
                    rule="Of two concurrent transactions writing the same object, only the first to commit may."
                    verdict={analysis.fcw}
                    onHover={setHoverOps}
                  />
                  <PropertyCard
                    name="Allowed under SI"
                    rule="Snapshot reads and first-committer-wins both hold."
                    verdict={analysis.si}
                    onHover={setHoverOps}
                  />
                  <PropertyCard
                    name="Serializable SI: no dangerous structure"
                    rule="No Tin →rw Tpivot →rw Tout between concurrent transactions."
                    verdict={analysis.ssi}
                    onHover={setHoverOps}
                  />
                </div>
              </div>

              <div className="chain">
                <h2 className="section-head">Recoverability — strongest first</h2>
                <div className="chain-row two">
                  <PropertyCard
                    name="Avoids cascading aborts (ACA)"
                    rule="Every version read was committed before the read (or is the reader's own)."
                    verdict={analysis.aca}
                    onHover={setHoverOps}
                  />
                  <Subset title="Every ACA schedule is recoverable" />
                  <PropertyCard
                    name="Recoverable"
                    rule="If Tj reads Ti's version, Ti commits before Tj commits."
                    verdict={analysis.recoverable}
                    onHover={setHoverOps}
                    impliedBy={analysis.aca.holds ? 'ACA' : undefined}
                  />
                </div>
              </div>
            </section>

            <ViewGraphPanel
              key={`view-${text}`}
              title="Multiversion view serializability — possible graphs"
              result={analysis.mvss}
              style={style}
              onStyle={setStyle}
              onHover={setHoverOps}
              finalWrites={false}
            />

            <section className="panel">
              <h2 className="section-head">Serialization graph (versions in commit order)</h2>
              <p className="panel-text">
                Over committed transactions, ordering each object&rsquo;s versions by when their
                writers commit, as snapshot isolation does. An rw anti-dependency Ti → Tj means Ti
                read a version that Tj&rsquo;s version directly overwrites. {analysis.dsg.summary}
              </p>
              <Legend rules={dsgRules} labels={DSG_LABELS} />
              <div className="graph-with-list">
                <GraphView
                  nodes={analysis.dsg.graph.nodes}
                  edges={analysis.dsg.graph.edges}
                  cycle={analysis.dsg.cycle}
                  onHover={setHoverOps}
                  labels={DSG_LABELS}
                />
                <EdgeRows edges={analysis.dsg.graph.edges} onHover={setHoverOps} />
              </div>
            </section>
          </main>
        </div>
      )}
    </>
  );
}
