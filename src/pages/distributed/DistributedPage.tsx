import { useMemo, useState } from 'react';
import { EdgeRows, PropertyCard, Subset } from '../../core/components/Cards';
import { GraphView, Legend } from '../../core/components/GraphView';
import { ScheduleGrid } from '../../core/components/ScheduleGrid';
import { orderText } from '../../core/format';
import type { EdgeRule } from '../../core/graph';
import { opText, parseSchedule } from '../../core/schedule';
import { analyseDistributed, parseSites, versionText } from './analysis';
import { DIST_DEFAULT, DIST_PRESETS } from './presets';
import { ReplicatedView } from './ReplicatedView';
import './DistributedPage.css';

const OBJECTS = ['A', 'B', 'C', 'D'];

function randomSchedule(): string {
  const n = 2 + Math.floor(Math.random() * 2);
  const queues = Array.from({ length: n }, (_, i) => {
    const t = i + 1;
    const q: string[] = [];
    const count = 2 + Math.floor(Math.random() * 3);
    for (let k = 0; k < count; k++) {
      const obj = OBJECTS[Math.floor(Math.random() * OBJECTS.length)];
      q.push(`${Math.random() < 0.5 ? 'R' : 'W'}${t}(${obj})`);
    }
    q.push(Math.random() < 0.9 ? `C${t}` : `A${t}`);
    return q;
  });
  const out: string[] = [];
  while (queues.some((q) => q.length > 0)) {
    const live = queues.filter((q) => q.length > 0);
    out.push(live[Math.floor(Math.random() * live.length)].shift()!);
  }
  return out.join(' ');
}

function rulesIn(edges: { rule: EdgeRule }[]): EdgeRule[] {
  return (['wr', 'rw', 'ww'] as EdgeRule[]).filter((r) => edges.some((e) => e.rule === r));
}

type Mode = 'replicated' | 'partitioned';

const MODES: { id: Mode; label: string; title: string }[] = [
  { id: 'replicated', label: 'Replicated: local schedules', title: 'One schedule per site; an object may have copies at several sites' },
  { id: 'partitioned', label: 'Partitioned: one global schedule', title: 'One interleaved schedule; each object lives at exactly one database' },
];

/** Several databases: replicated copies (one schedule per site), or partitioned data (one global schedule). */
export function DistributedPage() {
  const [mode, setMode] = useState<Mode>('replicated');
  return (
    <>
      <div className="mode-switch">
        <div className="segmented" role="group" aria-label="Kind of distribution">
          {MODES.map((m) => (
            <button key={m.id} className={m.id === mode ? 'on' : ''} aria-pressed={m.id === mode} title={m.title} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'replicated' ? <ReplicatedView /> : <PartitionedView />}
    </>
  );
}

/** One global schedule over objects split across databases: local vs global serializability. */
function PartitionedView() {
  const [text, setText] = useState(DIST_DEFAULT.schedule);
  const [sitesText, setSitesText] = useState(DIST_DEFAULT.sites);
  const [preset, setPreset] = useState(DIST_DEFAULT.id);
  const [hoverOps, setHoverOps] = useState<number[] | null>(null);

  const parsed = useMemo(() => parseSchedule(text), [text]);
  const schedule = parsed.schedule;
  const sites = useMemo(
    () => (schedule ? parseSites(sitesText, schedule.objects) : null),
    [schedule, sitesText],
  );
  const analysis = useMemo(
    () => (schedule && sites && sites.errors.length === 0 ? analyseDistributed(schedule, sites.sites) : null),
    [schedule, sites],
  );
  const highlight = useMemo(() => new Set(hoverOps ?? []), [hoverOps]);

  function choose(next: { schedule: string; sites?: string }, id = '') {
    setText(next.schedule);
    if (next.sites !== undefined) setSitesText(next.sites);
    setPreset(id);
    setHoverOps(null);
  }

  const errors = [...parsed.errors, ...(sites?.errors ?? [])];
  const differing = analysis ? analysis.reads.filter((r) => r.local !== r.global) : [];

  return (
    <>
      <p className="subtitle">
        CS4224 — one schedule across several databases, each holding some of the objects. Every
        database can be serializable on its own while the whole schedule is not; strict 2PL at
        every database rules that out, per-database snapshot isolation does not.
      </p>

      <section className="controls">
        <div className="control-group">
          <label htmlFor="dist-preset">Example</label>
          <select
            id="dist-preset"
            className="wide"
            value={preset}
            onChange={(e) => {
              const p = DIST_PRESETS.find((x) => x.id === e.target.value);
              if (p) choose(p, p.id);
            }}
          >
            <option value="" disabled>
              Custom
            </option>
            {DIST_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="control-group actions">
          <button
            className="ghost"
            onClick={() => choose({ schedule: randomSchedule(), sites: 'DB1: A, B\nDB2: C, D' })}
          >
            Random
          </button>
        </div>
        <div className="dist-inputs">
          <div className="schedule-input">
            <label htmlFor="dist-schedule">Schedule</label>
            <textarea
              id="dist-schedule"
              rows={3}
              value={text}
              spellCheck={false}
              onChange={(e) => choose({ schedule: e.target.value })}
              placeholder="R1(A) W2(A) R2(B) W1(B) C1 C2"
            />
          </div>
          <div className="schedule-input">
            <label htmlFor="dist-sites">Databases</label>
            <textarea
              id="dist-sites"
              rows={3}
              value={sitesText}
              spellCheck={false}
              onChange={(e) => {
                setSitesText(e.target.value);
                setPreset('');
              }}
              placeholder={'DB1: A, B\nDB2: C'}
            />
          </div>
        </div>
        <p className="field-hint">
          One database per line, <code>DB1: A, B</code>, and every object in exactly one. A
          transaction&rsquo;s <code>C1</code> or <code>A1</code> takes effect at every database it
          touched at once (atomic commit, as with two-phase commit). For snapshot isolation, each
          database takes a transaction&rsquo;s snapshot at its first operation <em>there</em>.
        </p>
      </section>

      {errors.length > 0 && (
        <div className="errors">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      {schedule && analysis && (
        <div className="layout">
          <aside className="side">
            <h2 className="section-head">Global schedule</h2>
            <ScheduleGrid
              schedule={schedule}
              highlight={highlight}
              tag={(op) => (op.obj ? analysis.siteOf.get(op.obj) ?? null : null)}
            />
            <p className="side-hint">Hover over an edge or a violation to light up its operations.</p>
          </aside>

          <main className="main">
            <section className="chains">
              <div className="chain">
                <h2 className="section-head">Serializability — strongest first</h2>
                <div className="chain-row">
                  <PropertyCard
                    name="Strict 2PL at every database"
                    rule="Each database could have produced its share holding every lock until commit."
                    verdict={analysis.allS2pl}
                    onHover={setHoverOps}
                  />
                  <Subset title="With atomic commit, S2PL at every database makes the whole schedule conflict serializable" />
                  <PropertyCard
                    name="Globally conflict serializable"
                    rule="The union of every database's precedence graph has no cycle."
                    verdict={analysis.global}
                    onHover={setHoverOps}
                    impliedBy={analysis.allS2pl.holds ? 'strict-2PL' : undefined}
                  />
                  <Subset title="A global serial order is also a serial order at each database" />
                  <PropertyCard
                    name="Each database conflict serializable"
                    rule="Every local precedence graph, on its own, has no cycle."
                    verdict={analysis.localCss}
                    onHover={setHoverOps}
                    impliedBy={analysis.global.holds ? 'globally serializable' : undefined}
                  />
                </div>
              </div>

              <div className="chain">
                <h2 className="section-head">Snapshot isolation at each database</h2>
                <div className="cards">
                  <PropertyCard
                    name="Consistent snapshots"
                    rule="Each transaction sees the same commits at every database it reads from."
                    verdict={analysis.snapshots}
                    onHover={setHoverOps}
                  />
                  <PropertyCard
                    name="First-committer-wins"
                    rule="Of two concurrent transactions writing the same object, only the first to commit may."
                    verdict={analysis.fcw}
                    onHover={setHoverOps}
                  />
                </div>
              </div>
            </section>

            <section className="panel">
              <h2 className="section-head">Global precedence graph</h2>
              <p className="panel-text">
                Conflicts only happen between operations on the same object, so every edge belongs
                to exactly one database; the global graph is their union. {analysis.global.summary}
              </p>
              <Legend rules={rulesIn(analysis.global.graph.edges)} />
              <div className="graph-with-list">
                <GraphView
                  nodes={analysis.global.graph.nodes}
                  edges={analysis.global.graph.edges}
                  cycle={analysis.global.cycle}
                  onHover={setHoverOps}
                />
                <EdgeRows edges={analysis.global.graph.edges} onHover={setHoverOps} />
              </div>
            </section>

            <section className="panel">
              <h2 className="section-head">Each database on its own</h2>
              <div className="site-grid">
                {analysis.locals.map((l) => (
                  <div key={l.site.name} className="site-card">
                    <div className="site-head">
                      <span className="site-name">{l.site.name}</span>
                      <span className="site-objects">{l.site.objects.join(', ')}</span>
                    </div>
                    <p className={`site-verdict ${l.css.holds ? 'yes' : 'no'}`}>
                      {l.css.holds
                        ? `✓ serializable: ${orderText(l.css.order!)}`
                        : `✗ not serializable`}
                      {' · '}
                      <span className={l.s2pl.holds ? 'yes' : 'no'}>
                        {l.s2pl.holds ? 'S2PL ✓' : 'S2PL ✗'}
                      </span>
                    </p>
                    <ScheduleGrid schedule={l.schedule} highlight={highlight} />
                    <GraphView
                      nodes={l.css.graph.nodes}
                      edges={l.css.graph.edges}
                      cycle={l.css.cycle}
                      onHover={setHoverOps}
                      compact
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <h2 className="section-head">Snapshot isolation: what each read would see</h2>
              <p className="panel-text">
                Per database, a transaction&rsquo;s snapshot is taken at its first operation at
                that database; with one global snapshot it is taken at its first operation
                anywhere. {differing.length === 0
                  ? 'Here the two agree for every read.'
                  : `${differing.length} read${differing.length === 1 ? '' : 's'} differ, highlighted below.`}
              </p>
              {analysis.reads.length === 0 ? (
                <p className="note">No reads.</p>
              ) : (
                <table className="reads-table">
                  <thead>
                    <tr>
                      <th>Read</th>
                      <th>Database</th>
                      <th>Per-database snapshot</th>
                      <th>One global snapshot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.reads.map((r) => (
                      <tr
                        key={r.read.index}
                        className={r.local !== r.global ? 'differs' : ''}
                        onMouseEnter={() => setHoverOps([r.read.index, r.localStart, r.globalStart])}
                        onMouseLeave={() => setHoverOps(null)}
                      >
                        <td className="mono">{opText(r.read)}</td>
                        <td>{r.site}</td>
                        <td>
                          {versionText(r.local, r.read.obj!)}{' '}
                          <span className="muted">(from step {r.localStart + 1})</span>
                        </td>
                        <td>
                          {versionText(r.global, r.read.obj!)}{' '}
                          <span className="muted">(from step {r.globalStart + 1})</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </main>
        </div>
      )}
    </>
  );
}
