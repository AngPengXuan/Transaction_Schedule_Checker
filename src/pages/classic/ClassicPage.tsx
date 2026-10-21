import { useMemo, useState } from 'react';
import { EdgeRows, PropertyCard, Subset } from '../../core/components/Cards';
import { GraphView, Legend } from '../../core/components/GraphView';
import { ScheduleGrid } from '../../core/components/ScheduleGrid';
import { ViewGraphPanel } from '../../core/components/ViewGraphPanel';
import { orderText } from '../../core/format';
import type { EdgeRule } from '../../core/graph';
import { parseSchedule } from '../../core/schedule';
import { strongerHolding } from '../../core/verdict';
import { useViewStyle } from '../../core/viewStyle';
import { analyse } from './analysis';
import { ALL_PRESETS, DEFAULT_PRESET, EXTRA_PRESETS, REGION_PRESETS } from './presets';
import type { RecoveryClass, SerialClass } from './presets';
import { RegionMap } from './RegionMap';
import './RegionMap.css';

function randomSchedule(): string {
  const n = 2 + Math.floor(Math.random() * 2);
  const objects = Math.random() < 0.5 ? ['A', 'B'] : ['A', 'B', 'C'];
  const queues = Array.from({ length: n }, (_, i) => {
    const t = i + 1;
    const q: string[] = [];
    const count = 2 + Math.floor(Math.random() * 2);
    for (let k = 0; k < count; k++) {
      const obj = objects[Math.floor(Math.random() * objects.length)];
      q.push(`${Math.random() < 0.5 ? 'R' : 'W'}${t}(${obj})`);
    }
    q.push(Math.random() < 0.85 ? `C${t}` : `A${t}`);
    return q;
  });
  const out: string[] = [];
  while (queues.some((q) => q.length > 0)) {
    const live = queues.filter((q) => q.length > 0);
    out.push(live[Math.floor(Math.random() * live.length)].shift()!);
  }
  return out.join(' ');
}

/** Monoversion schedules: serial, CSS, VSS, recoverable, ACA, strict. */
export function ClassicPage() {
  const [text, setText] = useState(DEFAULT_PRESET.schedule);
  const [preset, setPreset] = useState(DEFAULT_PRESET.id);
  const [hoverOps, setHoverOps] = useState<number[] | null>(null);
  const [style, setStyle] = useViewStyle();

  const parsed = useMemo(() => parseSchedule(text), [text]);
  const schedule = parsed.schedule;
  const analysis = useMemo(
    () => (schedule ? analyse(schedule, style) : null),
    [schedule, style],
  );
  const highlight = useMemo(() => new Set(hoverOps ?? []), [hoverOps]);

  function load(next: string, id = '') {
    setText(next);
    setPreset(id);
    setHoverOps(null);
  }

  const vss = analysis?.vss;
  const serClass: SerialClass = !analysis
    ? 0
    : analysis.serial.holds ? 3 : analysis.css.holds ? 2 : analysis.vss.holds ? 1 : 0;
  const serChain = analysis
    ? [
        { short: 'serial', holds: analysis.serial.holds },
        { short: 'CSS', holds: analysis.css.holds },
        { short: 'VSS', holds: analysis.vss.holds },
      ]
    : [];
  const recChain = analysis
    ? [
        { short: 'strict', holds: analysis.strict.holds },
        { short: 'ACA', holds: analysis.aca.holds },
        { short: 'recoverable', holds: analysis.recoverable.holds },
      ]
    : [];
  const recClass: RecoveryClass = !analysis
    ? 0
    : analysis.strict.holds ? 3 : analysis.aca.holds ? 2 : analysis.recoverable.holds ? 1 : 0;
  const cssRules = analysis
    ? (['wr', 'rw', 'ww'] as EdgeRule[]).filter((r) => analysis.css.graph.edges.some((e) => e.rule === r))
    : [];

  return (
    <>
      <p className="subtitle">
          CS3223 — is a schedule serial, conflict serializable, view serializable, recoverable,
          cascadeless, strict? Type one in and every check explains itself, with the precedence
          graph for CSS and every possible graph for VSS.
      </p>

      <section className="controls">
        <div className="control-group">
          <label htmlFor="preset">Example</label>
          <select
            id="preset"
            className="wide"
            value={preset}
            onChange={(e) => {
              const p = ALL_PRESETS.find((x) => x.id === e.target.value);
              if (p) load(p.schedule, p.id);
            }}
          >
            <option value="" disabled>
              Custom
            </option>
            <optgroup label="One per region of the diagram">
              {REGION_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="More special cases">
              {EXTRA_PRESETS.map((p) => (
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
        </div>
        <div className="schedule-input">
          <label htmlFor="schedule">Schedule</label>
          <textarea
            id="schedule"
            rows={2}
            value={text}
            spellCheck={false}
            onChange={(e) => load(e.target.value)}
            placeholder="R1(A) W2(A) R2(B) W1(B) C1 C2"
          />
        </div>
        <p className="field-hint">
          Operations <code>R1(A)</code>, <code>W2(B)</code>, commit <code>C1</code>, abort{' '}
          <code>A2</code>, separated by spaces or commas; <code>r1[a]</code> works too. CSS and
          VSS use the committed projection — aborted transactions are dropped, unfinished ones count
          as committed. <code>T0</code> is the virtual transaction that wrote every initial value.
        </p>
      </section>

      {parsed.errors.length > 0 && (
        <div className="errors">
          {parsed.errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      {schedule && analysis && vss && (
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
            <RegionMap
              ser={serClass}
              rec={recClass}
              onPick={(p) => load(p.schedule, p.id)}
            />
          </aside>

          <main className="main">
            <section className="chains">
              <div className="chain">
                <h2 className="section-head">Serializability — strongest first</h2>
                <div className="chain-row">
                  <PropertyCard
                    name="Serial"
                    rule="Each transaction finishes (C or A) before the next begins."
                    verdict={analysis.serial}
                    onHover={setHoverOps}
                  />
                  <Subset title="Every serial schedule is conflict serializable" />
                  <PropertyCard
                    name="Conflict serializable (CSS)"
                    rule="The precedence graph of conflicts has no cycle."
                    verdict={analysis.css}
                    onHover={setHoverOps}
                    impliedBy={strongerHolding(serChain, 1)}
                  />
                  <Subset title="Every conflict serializable schedule is view serializable" />
                  <PropertyCard
                    name="View serializable (VSS)"
                    rule="Some resolution of the view graph's choices has no cycle."
                    verdict={vss}
                    onHover={setHoverOps}
                    impliedBy={strongerHolding(serChain, 2)}
                  >
                    {vss.serialOrders && (
                      <p className="card-extra">
                        Checked by trying all serial orders:{' '}
                        {vss.serialOrders.length === 0
                          ? 'none is view-equivalent.'
                          : `view-equivalent to ${vss.serialOrders.map(orderText).join(', ')}.`}
                      </p>
                    )}
                  </PropertyCard>
                </div>
              </div>

              <div className="chain">
                <h2 className="section-head">Recoverability — strongest first</h2>
                <div className="chain-row">
                  <PropertyCard
                    name="Strict"
                    rule="No read or overwrite of a value until its writer commits or aborts."
                    verdict={analysis.strict}
                    onHover={setHoverOps}
                  />
                  <Subset title="Every strict schedule avoids cascading aborts" />
                  <PropertyCard
                    name="Avoids cascading aborts (ACA)"
                    rule="If Tj reads from Ti, Ti commits before that read."
                    verdict={analysis.aca}
                    onHover={setHoverOps}
                    impliedBy={strongerHolding(recChain, 1)}
                  />
                  <Subset title="Every ACA schedule is recoverable" />
                  <PropertyCard
                    name="Recoverable"
                    rule="If Tj reads from Ti, Ti commits before Tj commits."
                    verdict={analysis.recoverable}
                    onHover={setHoverOps}
                    impliedBy={strongerHolding(recChain, 2)}
                  />
                </div>
              </div>
            </section>

            <section className="panel">
              <h2 className="section-head">Conflict serializability — precedence graph</h2>
              <p className="panel-text">
                Edge Ti → Tj for each conflict where Ti&rsquo;s operation comes first: R<sub>i</sub>(x)
                → W<sub>j</sub>(x), W<sub>i</sub>(x) → R<sub>j</sub>(x), or W<sub>i</sub>(x) →
                W<sub>j</sub>(x). {analysis.css.summary}
              </p>
              <Legend rules={cssRules} />
              <div className="graph-with-list">
                <GraphView
                  nodes={analysis.css.graph.nodes}
                  edges={analysis.css.graph.edges}
                  cycle={analysis.css.cycle}
                  onHover={setHoverOps}
                />
                <EdgeRows edges={analysis.css.graph.edges} onHover={setHoverOps} />
              </div>
            </section>

            <ViewGraphPanel
              key={`view-${text}`}
              title="View serializability — possible graphs"
              result={vss}
              style={style}
              onStyle={setStyle}
              onHover={setHoverOps}
              finalWrites
            />
          </main>
        </div>
      )}
    </>
  );
}
