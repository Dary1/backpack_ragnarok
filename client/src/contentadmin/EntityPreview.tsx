// client/src/contentadmin/EntityPreview.tsx -- REQ-0173
// (contentadmin-entity-rendering A). Kind-aware, READ-ONLY rendering of a
// content variant's `data` as the GAME ENTITY it is -- not raw JSON -- so the
// adjudication desk judges shape/icon/name/rarity/effects the way the game
// presents them. Dex components are REUSED BY IMPORT (ShapeGrid + dexIcons,
// the exact DexAdmin list-thumb recipe), never forked. Rendered INSIDE every
// VariantCard by default (the View JSON toggle stays), and in a `compact`
// mode for the adopt confirm, the header, and the A/B diff.
//
// The invariant across EVERY kind: any top-level field the kind renderer did
// not consume is surfaced in a generic key:value fallback grid -- nothing is
// ever silently hidden. Unknown kinds render the fallback grid only. A
// missing icon id yields ShapeGrid's placeholder (no overlay), never a broken
// <img>.
import { ShapeGrid } from '../dex/ShapeGrid';
import { iconDataUrl, iconDims } from '../dex/dexIcons';
import type { IconAlign } from '../engine/engine.d.ts';
import { rarityClass, entityShape, jaField, effectLine, packPool, poolChances } from './contentShared';

type Data = Record<string, unknown>;

function scalarText(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const j = JSON.stringify(v);
  return j.length > 90 ? j.slice(0, 90) + '…' : j;
}

/** Generic key:value grid for the top-level fields a kind renderer did not
 * consume -- the "nothing silently hidden" guarantee. */
function FallbackGrid({ data, consumed, testid }: { data: Data; consumed: Set<string>; testid: string }) {
  const keys = Object.keys(data).filter((k) => !consumed.has(k));
  if (keys.length === 0) return null;
  return (
    <div data-testid={testid} className="ca-ep-fallback">
      {keys.map((k) => (
        <span key={k} className="ca-ep-field" title={scalarText(data[k])}>
          <b className="ca-ep-field-k">{k}</b>
          <span className="ca-ep-field-v">{scalarText(data[k])}</span>
        </span>
      ))}
    </div>
  );
}

function RarityChip({ rarity }: { rarity: unknown }) {
  if (typeof rarity !== 'string' || !rarity) return null;
  return <span className={'ca-ep-chip ' + rarityClass(rarity)}>{rarity}</span>;
}

function Names({ data }: { data: Data }) {
  const en = typeof data.name === 'string' ? data.name : '';
  const ja = jaField(data, 'name');
  return (
    <div className="ca-ep-names">
      <span className="ca-ep-name">{en || <span className="ca-ep-muted">(no name)</span>}</span>
      {ja ? <span className="ca-ep-name-ja">{ja}</span> : null}
      {typeof data.id === 'string' && data.id ? <span className="ca-ep-id">({data.id})</span> : null}
    </div>
  );
}

function Effects({ data, compact }: { data: Data; compact?: boolean }) {
  const effs = Array.isArray(data.effects) ? (data.effects as unknown[]) : [];
  const effEn = typeof data.eff_en === 'string' ? data.eff_en : '';
  if (effs.length === 0 && !effEn) return null;
  return (
    <div className="ca-ep-effects">
      {effEn ? <div className="ca-ep-eff-text">{effEn}</div> : null}
      {(compact ? effs.slice(0, 2) : effs).map((e, i) => (
        <div key={i} className="ca-ep-eff-line">{effectLine(e)}</div>
      ))}
      {compact && effs.length > 2 ? <div className="ca-ep-eff-line ca-ep-muted">+{effs.length - 2} more</div> : null}
    </div>
  );
}

function Flavor({ data }: { data: Data }) {
  const fl = typeof data.flavor === 'string' ? data.flavor : '';
  if (!fl) return null;
  return <div className="ca-ep-flavor">{fl}</div>;
}

function Tags({ data }: { data: Data }) {
  const tags = Array.isArray(data.tags) ? (data.tags as unknown[]).filter((t) => typeof t === 'string') : [];
  if (tags.length === 0) return null;
  return (
    <div className="ca-ep-tags">
      {tags.map((t, i) => <span key={i} className="ca-ep-tag chip">{String(t)}</span>)}
    </div>
  );
}

function IconGrid({ data, compact, artUrl }: { data: Data; compact?: boolean; artUrl?: string | null }) {
  const icon = typeof data.icon === 'string' ? data.icon : '';
  const cellPx = compact ? 18 : 28;
  // REQ-0133: registry-first, exactly like the game board. When an adopted
  // registry render exists (artUrl), draw THAT; else the SVG sprite. iconDims
  // (the sprite's native aspect) stays the contain-fit input -- the backfilled
  // registry raster is aspect-identical, and explicit AI art is fit into the
  // same footprint.
  const registry = typeof artUrl === 'string' && artUrl.length > 0;
  const url = registry ? artUrl : (icon ? iconDataUrl(icon) : null);
  return (
    <span className="ca-ep-thumb">
      <ShapeGrid
        shape={entityShape(data)}
        cellPx={cellPx}
        iconUrl={url}
        iconAlt={icon}
        iconDims={icon ? iconDims(icon) : null}
        iconStretch={typeof data.stretch === 'boolean' ? data.stretch : undefined}
        iconAlign={(data.align as IconAlign | undefined)}
      />
    </span>
  );
}

/** REQ-0133: labels which art tier the preview drew -- the SAME chain the game
 * resolves (registry adopted render -> sprite icon), so the desk sees exactly
 * what the game shows. `registry` true => an adopted registry render exists. */
function ArtSourceLabel({ registry, idBase }: { registry: boolean; idBase: string | number }) {
  return (
    <span data-testid={'entity-art-source-' + idBase}
      className={'ca-ep-artsrc ' + (registry ? 'is-registry' : 'is-sprite')}>
      {registry ? 'registry art' : 'sprite icon'}
    </span>
  );
}

export function EntityPreview({ kind, data, idBase, compact, artUrl }: {
  kind: string;
  data: Data;
  idBase: string | number;
  compact?: boolean;
  /** REQ-0133: the def's adopted registry-render URL (game-mirror), or null/
   * absent to show the SVG sprite. Passed by VariantCard from the contentadmin's
   * own live artwork resolution; absent on surfaces that don't resolve art
   * (they show the sprite + label accordingly). */
  artUrl?: string | null;
}) {
  const testid = 'entity-preview-' + idBase;
  const fbTestid = 'entity-fallback-' + idBase;
  const cls = 'ca-ep' + (compact ? ' ca-ep--compact' : '');
  const registryArt = typeof artUrl === 'string' && artUrl.length > 0;

  // ---- po_def / si_def: shape grid + names + rarity + tags + flavor + effects
  if (kind === 'po_def' || kind === 'si_def') {
    const consumed = new Set<string>([
      'id', 'name', 'name_ja', 'i18n', 'rarity', 'tags', 'flavor', 'flavor_ja',
      'shape', 'icon', 'stretch', 'align', 'effects', 'eff_en', 'eff_ja', 'slot',
    ]);
    const slot = kind === 'si_def' && typeof data.slot === 'string' ? data.slot : '';
    return (
      <div data-testid={testid} className={cls}>
        <div className="ca-ep-head">
          <IconGrid data={data} compact={compact} artUrl={artUrl} />
          <div className="ca-ep-headtext">
            <Names data={data} />
            <div className="ca-ep-chips">
              <RarityChip rarity={data.rarity} />
              {slot ? <span className="ca-ep-chip ca-ep-slot">slot: {slot}</span> : null}
              <ArtSourceLabel registry={registryArt} idBase={idBase} />
            </div>
            {!compact ? <Tags data={data} /> : null}
          </div>
        </div>
        {!compact ? <Flavor data={data} /> : null}
        <Effects data={data} compact={compact} />
        <FallbackGrid data={data} consumed={consumed} testid={fbTestid} />
      </div>
    );
  }

  // ---- tm_def: icon + names + rarity + flavor
  if (kind === 'tm_def') {
    const consumed = new Set<string>([
      'id', 'name', 'name_ja', 'i18n', 'icon', 'rarity', 'flavor', 'flavor_ja',
    ]);
    return (
      <div data-testid={testid} className={cls}>
        <div className="ca-ep-head">
          <IconGrid data={data} compact={compact} artUrl={artUrl} />
          <div className="ca-ep-headtext">
            <Names data={data} />
            <div className="ca-ep-chips"><RarityChip rarity={data.rarity} /><ArtSourceLabel registry={registryArt} idBase={idBase} /></div>
          </div>
        </div>
        {!compact ? <Flavor data={data} /> : null}
        <FallbackGrid data={data} consumed={consumed} testid={fbTestid} />
      </div>
    );
  }

  // ---- monster_def (enemy/1 dialect): names + hp range + rarity + skills
  if (kind === 'monster_def') {
    const consumed = new Set<string>(['id', 'name', 'name_ja', 'i18n', 'hp', 'rarity', 'skills']);
    const hp = Array.isArray(data.hp) ? (data.hp as unknown[]) : null;
    const skills = Array.isArray(data.skills) ? (data.skills as unknown[]) : [];
    return (
      <div data-testid={testid} className={cls}>
        <div className="ca-ep-headtext">
          <Names data={data} />
          <div className="ca-ep-chips">
            <RarityChip rarity={data.rarity} />
            {hp ? <span className="ca-ep-chip ca-ep-hp">hp [{hp.map(String).join('–')}]</span> : null}
          </div>
          {skills.length > 0 ? (
            <div className="ca-ep-skills">
              <span className="ca-ep-muted">skills:</span>
              {skills.map((sk, i) => <span key={i} className="ca-ep-skill chip">{String(sk)}</span>)}
            </div>
          ) : null}
        </div>
        <FallbackGrid data={data} consumed={consumed} testid={fbTestid} />
      </div>
    );
  }

  // ---- skill_def (skill/1): id/names + effect lines
  if (kind === 'skill_def') {
    const consumed = new Set<string>(['id', 'name', 'name_ja', 'i18n', 'effects', 'eff_en', 'eff_ja']);
    return (
      <div data-testid={testid} className={cls}>
        <div className="ca-ep-headtext">
          <Names data={data} />
        </div>
        <Effects data={data} compact={compact} />
        <FallbackGrid data={data} consumed={consumed} testid={fbTestid} />
      </div>
    );
  }

  // ---- gacha_pack (gacha_pack/1): what it costs, what it can cast, and how likely
  // REQ-0171. The pool is the whole point of the kind, so it is rendered as the table
  // an operator actually reasons about: unit, weight, and the DERIVED percentage. The
  // percentage is never stored -- weight is what the roll consumes (gacha.cjs's
  // pickWeighted), and a stored percentage is a second source of truth waiting to
  // disagree with the first.
  if (kind === 'gacha_pack') {
    const consumed = new Set<string>([
      'id', 'name', 'name_ja', 'i18n', 'cost', 'cost_tm', 'cells', 'hp_per_cell', 'pool',
    ]);
    const rows = poolChances(packPool(data));
    const cells = Array.isArray(data.cells) ? (data.cells as unknown[]) : null;
    const hpPer = typeof data.hp_per_cell === 'number' ? data.hp_per_cell : null;
    return (
      <div data-testid={testid} className={cls}>
        <div className="ca-ep-headtext">
          <Names data={data} />
          <div className="ca-ep-chips">
            {typeof data.cost === 'number'
              ? <span className="ca-ep-chip">cost {data.cost}{typeof data.cost_tm === 'string' ? ' ' + data.cost_tm : ''}</span>
              : null}
            {cells ? <span className="ca-ep-chip">{cells.map(String).join('–')} cells</span> : null}
            {hpPer !== null ? <span className="ca-ep-chip ca-ep-hp">HP {hpPer}/cell</span> : null}
            <span className="ca-ep-chip">{rows.length} units</span>
          </div>
        </div>
        {rows.length > 0 ? (
          <div className="ca-ep-pool" data-testid="cd-ep-pool">
            {rows.map((r) => (
              <span key={r.unit} className="ca-ep-pool-row" data-testid="cd-ep-pool-row" data-unit={r.unit}>
                <b className="ca-ep-pool-unit">{r.unit}</b>
                <span className="ca-ep-pool-weight t-micro">w {r.weight}</span>
                <span className="ca-ep-pool-pct tnum">{r.pct.toFixed(1)}%</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="ca-ep-muted" data-testid="cd-ep-pool-empty">(empty pool — this pack can emit nothing)</div>
        )}
        <FallbackGrid data={data} consumed={consumed} testid={fbTestid} />
      </div>
    );
  }

  // ---- unknown kind: fallback grid only (nothing hidden)
  return (
    <div data-testid={testid} className={cls}>
      {typeof data.name === 'string' ? <div className="ca-ep-headtext"><Names data={data} /></div> : null}
      <FallbackGrid data={data} consumed={new Set<string>(['name', 'name_ja', 'i18n'])} testid={fbTestid} />
    </div>
  );
}
