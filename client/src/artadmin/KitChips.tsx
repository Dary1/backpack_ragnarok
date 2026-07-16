// client/src/artadmin/KitChips.tsx -- REQ-0152 inspection-kit chips,
// restyled by REQ-0156 onto the MJOLNIR chip grammar. STRICTLY advisory:
// verdicts never gate adoption (standing rule). The full REQ-0152 testid
// contract is preserved verbatim (kits-/kit-/chip-/verdict-/stale-/rerun-/
// run-<seed>-<kit_id>, kit-details-...) -- artinspect.spec.ts drives these.
import type { InspectionDto, KitDto, RenderDto } from '../api';

// REQ-0193: params provenance the cutout chip reads off the renders list.
// Not a kit -- there is no verdict and no inspect_kits.json entry; the chip
// only borrows the un-run kit grammar the user pointed at.
interface DerivedParams { derived?: string; derived_from_seed?: number }
function paramsOf(r: RenderDto): DerivedParams {
  return (r.params && typeof r.params === 'object' ? r.params : {}) as DerivedParams;
}
function isCutout(r: RenderDto): boolean {
  return paramsOf(r).derived === 'background_cutout';
}

/** The cutout chip: 'not cut [run]' until a cutout of this seed exists, then
 * the derived seed. A render that IS a cutout gets no run affordance (no
 * cutout of a cutout -- the route refuses it too). Rendered for EVERY kind:
 * a matte needs no cell footprint, so any ok render can be cut out. */
function CutoutChip({ seed, renders, onCutout }: {
  seed: number; renders: RenderDto[]; onCutout: (seed: number) => void;
}) {
  const self = renders.find((r) => r.seed === seed);
  const derived = renders.find((r) => isCutout(r) && paramsOf(r).derived_from_seed === seed);
  if (self && isCutout(self)) {
    return (
      <span data-testid={'cutout-' + seed} className="chip aa-kit-none">
        nobackgroundcutout: is a cutout of seed {paramsOf(self).derived_from_seed}
      </span>
    );
  }
  if (derived) {
    return (
      <span data-testid={'cutout-' + seed} className="chip aa-kit-none">
        nobackgroundcutout: cut
        <span data-testid={'cutout-link-' + seed} className="aa-cutout-seed"> -&gt; seed {derived.seed}</span>
      </span>
    );
  }
  return (
    <span data-testid={'cutout-' + seed} className="chip aa-kit-none">
      nobackgroundcutout: not cut
      <button data-testid={'run-cutout-' + seed} type="button" className="aa-linkbtn"
        title="derive a background-removed copy at seed+100000 (REQ-0193)"
        onClick={() => onCutout(seed)}>run</button>
    </span>
  );
}

function verdictClass(v: string): string {
  return v === 'PASS' ? 'aa-verdict--pass' : v === 'WARN' ? 'aa-verdict--warn' : 'aa-verdict--fail';
}

function InspectDetails({ row, seed }: { row: InspectionDto; seed: number }) {
  return (
    <div data-testid={'kit-details-' + seed + '-' + row.kit_id} className="aa-kit-details">
      <div>v{row.kit_version}{row.stale ? ' (STALE)' : ''}</div>
      <div className="aa-kit-details-h">metrics</div>
      {Object.entries(row.metrics).map(([k, v]) => <div key={k}>{k}={String(v)}</div>)}
      <div className="aa-kit-details-h">checks</div>
      {row.checks.map((c, i) => <div key={i} className={c.ok ? 'aa-check-ok' : 'aa-check-bad'}>{c.ok ? 'ok' : 'x'} {c.name} ({String(c.value)} / {c.threshold})</div>)}
      {row.notes.length > 0 && <div className="aa-kit-details-h">notes</div>}
      {row.notes.map((nt, i) => <div key={i} className="aa-kit-note">- {nt}</div>)}
    </div>
  );
}

export function KitChips({ seed, kits, rows, renders, expanded, onToggle, onRerun, onCutout }: {
  seed: number; kits: KitDto[]; rows: InspectionDto[]; renders: RenderDto[];
  expanded: Record<string, boolean>; onToggle: (key: string) => void;
  onRerun: (seed: number, kitId?: string) => void;
  onCutout: (seed: number) => void;
}) {
  const byKit = new Map(rows.map((r) => [r.kit_id, r]));
  return (
    <div data-testid={'kits-' + seed} className="aa-kits">
      <CutoutChip seed={seed} renders={renders} onCutout={onCutout} />
      {kits.map((k) => {
        const row = byKit.get(k.kit_id);
        if (!row) {
          return (
            <span key={k.kit_id} data-testid={'kit-' + seed + '-' + k.kit_id} className="chip aa-kit-none">
              {k.kit_id}: not inspected
              <button data-testid={'run-' + seed + '-' + k.kit_id} type="button" className="aa-linkbtn"
                onClick={() => onRerun(seed, k.kit_id)}>run</button>
            </span>
          );
        }
        const key = seed + '|' + k.kit_id;
        return (
          <span key={k.kit_id} data-testid={'kit-' + seed + '-' + k.kit_id} className="aa-kit">
            <button data-testid={'chip-' + seed + '-' + k.kit_id} type="button"
              className={'aa-verdict ' + verdictClass(row.verdict)}
              title={k.kit_id + ' v' + row.kit_version}
              onClick={() => onToggle(key)}>
              {k.kit_id} <b data-testid={'verdict-' + seed + '-' + k.kit_id}>{row.verdict}</b>
            </button>
            {row.stale && <span data-testid={'stale-' + seed + '-' + k.kit_id} className="aa-stale">stale</span>}
            {row.stale && <button data-testid={'rerun-' + seed + '-' + k.kit_id} type="button" className="aa-linkbtn"
              onClick={() => onRerun(seed, k.kit_id)}>re-run</button>}
            {expanded[key] && <InspectDetails row={row} seed={seed} />}
          </span>
        );
      })}
    </div>
  );
}
