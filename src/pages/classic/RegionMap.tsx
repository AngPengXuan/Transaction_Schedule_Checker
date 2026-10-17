import { REGION_PRESETS } from './presets';
import type { Preset, RecoveryClass, SerialClass } from './presets';

interface Props {
  ser: SerialClass;
  rec: RecoveryClass;
  onPick: (p: Preset) => void;
}

const COLUMNS = ['not VSS', 'VSS only', 'CSS only', 'Serial'];
const ROWS = ['not recov.', 'Recoverable', 'ACA', 'Strict'];
const NOT_STRICT = ['not recoverable', 'recoverable but not ACA', 'ACA but not strict'];

/**
 * The classic diagram as a grid: serializability across, recoverability down.
 * Serial gets its own column, but only its Strict cell can hold a schedule --
 * a serial schedule never reads or overwrites uncommitted data -- so the cells
 * above it are dashes. The schedule's own region is lit, and every region
 * loads its example on click.
 */
export function RegionMap({ ser, rec, onPick }: Props) {
  const serial = REGION_PRESETS.find((p) => p.id === 'serial')!;
  const at = (s: number, r: number) =>
    REGION_PRESETS.find((p) => p.region!.ser === s && p.region!.rec === r)!;

  return (
    <figure className="region-map">
      <figcaption>Where this schedule sits</figcaption>
      <div className="region-grid">
        <span />
        {COLUMNS.map((c) => (
          <span key={c} className="region-col">
            {c}
          </span>
        ))}
        {ROWS.map((row, r) => (
          <div key={row} className="region-row">
            <span className="region-rowhead">{row}</span>
            {COLUMNS.map((_, s) => {
              if (s === 3 && r < 3) {
                return (
                  <div
                    key={s}
                    className="region impossible"
                    title={`Impossible: every serial schedule is strict, so none is ${NOT_STRICT[r]}.`}
                  >
                    —
                  </div>
                );
              }
              const p = s === 3 ? serial : at(s, r);
              const here = ser === s && rec === r;
              return (
                <div key={s} className={`region ${here ? 'here' : ''}`}>
                  <button className="region-pick" title={p.name} onClick={() => onPick(p)}>
                    {s === 3 ? 'Serial' : p.id}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="region-hint">Click a region to load its example.</p>
    </figure>
  );
}
