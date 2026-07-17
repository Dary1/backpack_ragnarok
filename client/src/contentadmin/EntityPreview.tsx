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
import { rarityClass, entityShape, jaField, effectLine, packPool, poolChances,
  packMembers, cellsFor, formatA1, isPlaceable, FIELD_COLS, FIELD_ROWS, PLACEABLE } from './contentShared';

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

export function EntityPreview({ kind, data, idBase, compact, artUrl, footprints }: {
  kind: string;
  data: Data;
  idBase: string | number;
  compact?: boolean;
  /** REQ-0133: the def's adopted registry-render URL (game-mirror), or null/
   * absent to show the SVG sprite. Passed by VariantCard from the contentadmin's
   * own live artwork resolution; absent on surfaces that don't resolve art
   * (they show the sprite + label accordingly). */
  artUrl?: string | null;
  /** REQ-0184 (monster_pack): enemy id -> footprint [fh,fw], resolved from each
   * monster's LINKED ARTWORK (artworks.shape {w,h} is the cell grid). Members
   * absent from the map are drawn 1x1 AND labelled as guesses -- an unlabelled
   * 1x1 boss would be a preview that lies about the very thing this kind exists
   * to show. Built by contentShared buildMemberFootprints(). */
  footprints?: Record<string, unknown> | null;
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

  // ---- monster_pack (monster_pack/1): the pack AS A BOARD
  // REQ-0184. WHERE each monster stands is the whole point of the kind, so a pack
  // is rendered as the 26x18 field it is fought on, with the 24x16 placeable area
  // (B2:Y17) marked and the 1-cell margin visibly outside it. This is the surface
  // that makes the pre-REQ-0184 bug obvious at a glance: a pack sitting on the
  // margin reads as monsters standing in the gutter.
  //
  // HONEST LIMIT: a member's occupied cells derive from its enemy def's footprint,
  // and the contentadmin does not hold the monster roster client-side (it has the
  // def LIST, not every def's adopted data). Rather than draw a 3x3 boss as a
  // single cell and let the desk believe it, the board draws anchors at 1x1 and
  // SAYS so. `footprints` lets any caller that can resolve them get the true
  // shape. See the REQ's "Honest gap".
  if (kind === 'monster_pack') {
    const consumed = new Set<string>(['id', 'name', 'name_ja', 'i18n', 'members', 'note']);
    const members = packMembers(data);
    // REQ-0184: a member's footprint comes from its monster's LINKED ARTWORK
    // (artworks.shape {w,h} IS the cell grid -- art_sizing.cjs). Resolution is
    // PER MEMBER, not all-or-nothing: a pack can mix monsters that have art with
    // monsters that do not, and the board says exactly which ones it had to guess.
    const fpOf = (enemy: string): unknown => (footprints && footprints[enemy]) || [1, 1];
    const unresolved = members.filter((m) => !(footprints && footprints[m.enemy]));
    const resolvedCount = members.length - unresolved.length;
    // cell key -> member index. Later members win the DRAW; the server's overlap
    // check is what actually fails the variant.
    const occ = new Map<string, number>();
    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      if (!m.anchor) continue;
      for (const [r, c] of cellsFor(m.anchor, fpOf(m.enemy))) occ.set(r + ',' + c, i);
    }
    const bad = members.filter((m) => !m.anchor);
    const outside = members.filter((m) => m.anchor && !isPlaceable(m.anchor.row, m.anchor.col));
    const rows = [];
    for (let r = 1; r <= FIELD_ROWS; r++) {
      const cs = [];
      for (let c = 1; c <= FIELD_COLS; c++) {
        const who = occ.get(r + ',' + c);
        const inArea = isPlaceable(r, c);
        const cls2 = 'ca-ep-bcell'
          + (inArea ? '' : ' is-margin')
          + (who !== undefined ? ' is-occ' : '')
          + (who !== undefined && !inArea ? ' is-illegal' : '');
        cs.push(
          <span key={c} className={cls2} data-testid={who !== undefined ? 'cd-ep-board-occ' : undefined}
            data-cell={formatA1(r, c)} data-enemy={who !== undefined ? members[who].enemy : undefined}
            title={who !== undefined ? members[who].enemy + ' @ ' + members[who].at : formatA1(r, c)} />,
        );
      }
      rows.push(<div key={r} className="ca-ep-brow">{cs}</div>);
    }
    return (
      <div data-testid={testid} className={cls}>
        <div className="ca-ep-headtext">
          <Names data={data} />
          <div className="ca-ep-chips">
            <span className="ca-ep-chip">{members.length} monster{members.length === 1 ? '' : 's'}</span>
            <span className="ca-ep-chip">field {FIELD_COLS}x{FIELD_ROWS}</span>
            <span className="ca-ep-chip">placeable {formatA1(PLACEABLE.rowMin, PLACEABLE.colMin)}:{formatA1(PLACEABLE.rowMax, PLACEABLE.colMax)}</span>
            {resolvedCount > 0
              ? <span className="ca-ep-chip" data-testid="cd-ep-fp-from-art">{resolvedCount}/{members.length} footprint{resolvedCount === 1 ? '' : 's'} from art</span>
              : null}
            {unresolved.length > 0
              ? <span className="ca-ep-chip ca-ep-chip--warn" data-testid="cd-ep-fp-unresolved"
                  title={'no linked artwork: ' + Array.from(new Set(unresolved.map((m) => m.enemy))).join(', ')}>
                  {unresolved.length} drawn 1x1 (no art)
                </span>
              : null}
            {outside.length > 0 ? <span className="ca-ep-chip ca-ep-chip--warn" data-testid="cd-ep-board-outside">{outside.length} outside the placeable area</span> : null}
            {bad.length > 0 ? <span className="ca-ep-chip ca-ep-chip--warn" data-testid="cd-ep-board-badat">{bad.length} malformed anchor</span> : null}
          </div>
        </div>
        <div className="ca-ep-board" data-testid="cd-ep-board">{rows}</div>
        <div className="ca-ep-members" data-testid="cd-ep-members">
          {members.map((m, i) => (
            <span key={i} className="ca-ep-member" data-testid="cd-ep-member" data-enemy={m.enemy}>
              <b className="ca-ep-member-id">{m.enemy}</b>
              <span className={'ca-ep-member-at tnum' + (m.anchor ? '' : ' is-bad')}>{m.at || '(no at)'}</span>
              {footprints && footprints[m.enemy]
                ? <span className="ca-ep-member-fp t-micro">{(footprints[m.enemy] as number[])[1]}x{(footprints[m.enemy] as number[])[0]}</span>
                : <span className="ca-ep-member-fp t-micro is-guess" title="no linked artwork -- drawn 1x1">1x1?</span>}
            </span>
          ))}
        </div>
        <FallbackGrid data={data} consumed={consumed} testid={fbTestid} />
      </div>
    );
  }

  // ---- gimic (gimic/1): the interactable dungeon gimmicks (trap / treasure box / hidden door)
  // REQ-0211. behavior is the family; type/mode the engine interaction; footprint/hp/
  // timeout/skills the parameters the dungeon generator reads. Same "nothing hidden"
  // invariant as every kind -- the FallbackGrid catches any field not rendered here.
  if (kind === 'gimic') {
    const consumed = new Set<string>(['id', 'name', 'name_ja', 'i18n', 'behavior', 'type', 'mode', 'hp', 'footprint', 'masked', 'timeout_secs', 'skills', 'note']);
    const behavior = typeof data.behavior === 'string' ? data.behavior : '';
    const mode = typeof data.mode === 'string' ? data.mode : '';
    const type = typeof data.type === 'string' ? data.type : '';
    const fp = Array.isArray(data.footprint) ? (data.footprint as unknown[]) : null;
    const skills = Array.isArray(data.skills) ? (data.skills as unknown[]) : [];
    return (
      <div data-testid={testid} className={cls}>
        <div className="ca-ep-headtext">
          <Names data={data} />
          <div className="ca-ep-chips">
            {behavior ? <span className="ca-ep-chip" data-testid="cd-ep-behavior">{behavior}</span> : null}
            {type ? <span className="ca-ep-chip ca-ep-muted">{type}</span> : null}
            {mode ? <span className="ca-ep-chip">{mode}</span> : null}
            {typeof data.hp === 'number' ? <span className="ca-ep-chip ca-ep-hp">hp {data.hp}</span> : null}
            {fp ? <span className="ca-ep-chip">footprint {fp.map(String).join('×')}</span> : null}
            {typeof data.timeout_secs === 'number' ? <span className="ca-ep-chip">{data.timeout_secs}s</span> : null}
            {data.masked === true ? <span className="ca-ep-chip">masked</span> : null}
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

  // ---- dungeon (dungeon/1): authored, PROBABILITY-WEIGHTED references to
  // monster_pack + gimic defs (REQ-0185). The roller turns these weighted pools +
  // level bands into a concrete dive; the preview shows the probability SPACE the
  // author curated (weights -> drop %), never a single rolled instance. Same
  // "nothing hidden" invariant -- FallbackGrid catches any unrendered field.
  if (kind === 'dungeon') {
    const consumed = new Set<string>(['id', 'name', 'name_ja', 'i18n', 'theme', 'levelMin', 'levelMax', 'dive', 'packPool', 'bossPool', 'gimicPool', 'rewards', 'note']);
    const theme = typeof data.theme === 'string' ? data.theme : '';
    const lvlMin = typeof data.levelMin === 'number' ? data.levelMin : null;
    const lvlMax = typeof data.levelMax === 'number' ? data.levelMax : null;
    const readPool = (raw: unknown, idKey: string): Array<{ id: string; weight: number; pct: number }> => {
      const parsed: Array<{ id: string; weight: number }> = [];
      for (const r of (Array.isArray(raw) ? raw : [])) {
        if (!r || typeof r !== 'object') continue;
        const row = r as Record<string, unknown>;
        const id = typeof row[idKey] === 'string' ? (row[idKey] as string) : '';
        if (!id) continue;
        const w = typeof row.weight === 'number' && Number.isFinite(row.weight) ? row.weight : 0;
        parsed.push({ id, weight: w });
      }
      const total = parsed.reduce((n, r) => n + Math.max(0, r.weight), 0);
      return parsed.map((r) => ({ ...r, pct: total > 0 ? (Math.max(0, r.weight) / total) * 100 : 0 }));
    };
    const packRows = readPool(data.packPool, 'packId');
    const bossRows = readPool(data.bossPool, 'packId');
    const gimicRows = readPool(data.gimicPool, 'gimic');
    const dive = data.dive && typeof data.dive === 'object' ? (data.dive as Record<string, unknown>) : null;
    const bandStr = (b: unknown): string => {
      if (!b || typeof b !== 'object') return '';
      const o = b as Record<string, unknown>;
      const base = typeof o.base === 'number' ? String(o.base) : '?';
      const max = typeof o.max === 'number' ? String(o.max) : '?';
      return base + '–' + max;
    };
    return (
      <div data-testid={testid} className={cls}>
        <div className="ca-ep-headtext">
          <Names data={data} />
          <div className="ca-ep-chips">
            {theme ? <span className="ca-ep-chip" data-testid="cd-ep-theme">{theme}</span> : null}
            {lvlMin != null && lvlMax != null ? <span className="ca-ep-chip">Lv {lvlMin}{'–'}{lvlMax}</span> : null}
            {dive ? <span className="ca-ep-chip">packs {bandStr(dive.packEncounters)}</span> : null}
            {dive ? <span className="ca-ep-chip">gimics {bandStr(dive.gimicSlots)}</span> : null}
          </div>
          {packRows.length > 0 ? (
            <div className="ca-ep-pool" data-testid="cd-ep-packpool">
              <span className="ca-ep-muted">packs:</span>
              {packRows.map((r, i) => <span key={i} className="ca-ep-chip">{r.id} <span className="ca-ep-muted">{r.pct.toFixed(0)}%</span></span>)}
            </div>
          ) : null}
          {bossRows.length > 0 ? (
            <div className="ca-ep-pool" data-testid="cd-ep-bosspool">
              <span className="ca-ep-muted">boss:</span>
              {bossRows.map((r, i) => <span key={i} className="ca-ep-chip">{r.id} <span className="ca-ep-muted">{r.pct.toFixed(0)}%</span></span>)}
            </div>
          ) : null}
          {gimicRows.length > 0 ? (
            <div className="ca-ep-pool" data-testid="cd-ep-gimicpool">
              <span className="ca-ep-muted">gimics:</span>
              {gimicRows.map((r, i) => <span key={i} className="ca-ep-chip">{r.id} <span className="ca-ep-muted">{r.pct.toFixed(0)}%</span></span>)}
            </div>
          ) : null}
        </div>
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
