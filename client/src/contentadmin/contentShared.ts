// client/src/contentadmin/contentShared.ts -- REQ-0157. Shared types + pure
// helpers for the content-admin components (page split out of the REQ-0155
// single-file ContentAdminPage, mirroring the artadmin/artShared.ts pattern
// of REQ-0156). Registry semantics live on the server; everything here is
// display/validation sugar only.
// REQ-0164 (contentadmin-ux-r2): fmtDate now renders LOCAL time (title attr
// keeps the raw ISO), a kind-driven schema_ref default map replaces the flat
// placeholder, and a client-side def sort helper backs the rail sort control.
import type { ContentDefDto, ContentVariantDto, ArtworkDto } from '../api';
import { artAdoptedUrl, artRenderUrl } from '../api';
import type { Cell } from '../engine/engine.d.ts';

export type Kind = 'po_def' | 'si_def' | 'monster_def' | 'unit_def' | 'tm_def' | 'skill_def' | 'gacha_pack';
export const KINDS: Kind[] = ['po_def', 'si_def', 'monster_def', 'unit_def', 'tm_def', 'skill_def', 'gacha_pack'];

// Mirror of routes/content.cjs RESERVED (path segments the public serving
// GET owns) -- checked client-side for instant feedback; the server
// re-checks on POST.
export const RESERVED_NAMES = ['defs', 'dev', 'meta'];

// REQ-0164 G: kind -> canon schema_ref default (the backfill's origin_schema
// truth). Single source for CreatePanel's pristine auto-swap. unit_def has no
// canon schema yet (documented) -- keep the generic vocab placeholder.
export const SCHEMA_REF_DEFAULTS: Record<Kind, string> = {
  po_def: 'po/2',
  si_def: 'si/2',
  tm_def: 'tm/1',
  monster_def: 'enemy/1',
  skill_def: 'skill/1',
  // REQ-0171: both of these now HAVE a canon schema (REQ-0170 shipped them as live
  // content), so the generic vocab placeholder that unit_def used to carry is retired.
  unit_def: 'unit/1',
  gacha_pack: 'gacha_pack/1',
};

/** REQ-0171: one row of a gacha pack's emission pool. */
export interface PoolRow { unit: string; weight: number }

/** Reads a pack's pool defensively out of a variant's untyped `data`. A malformed row
 * is DROPPED from the display rather than rendered as garbage -- the machine check is
 * what fails it, and the preview's job is to show what the roll would actually do. */
export function packPool(data: Record<string, unknown>): PoolRow[] {
  const raw = Array.isArray(data.pool) ? (data.pool as unknown[]) : [];
  const out: PoolRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const row = r as Record<string, unknown>;
    if (typeof row.unit !== 'string') continue;
    const w = typeof row.weight === 'number' && Number.isFinite(row.weight) ? row.weight : 0;
    out.push({ unit: row.unit, weight: w });
  }
  return out;
}

/** The REAL drop chance of each pool row: weight / total weight, as a percentage.
 * The admin edits WEIGHTS (that is what the roll consumes -- see gacha.cjs
 * pickWeighted); the percentage is derived and shown, never stored. Storing both is how
 * a pool starts lying about itself. Total weight 0 -> every row reads 0%. */
export function poolChances(pool: PoolRow[]): Array<PoolRow & { pct: number }> {
  const total = pool.reduce((n, r) => n + Math.max(0, r.weight), 0);
  return pool.map((r) => ({ ...r, pct: total > 0 ? (Math.max(0, r.weight) / total) * 100 : 0 }));
}
/** Canon schema_ref default for a kind (falls back to the generic vocab
 * placeholder for any future/unknown kind). */
export function defaultSchemaRef(kind: string): string {
  return (SCHEMA_REF_DEFAULTS as Record<string, string>)[kind] || 'content/vocab.json';
}

/** Live create-form name validation: regex, reserved words, duplicates
 * against the loaded def list. Returns an error string or null when OK. */
export function validateNewName(name: string, existing: ContentDefDto[]): string | null {
  if (!name) return null; // empty handled by the disabled Create button
  if (!/^[A-Za-z0-9_]+$/.test(name)) return 'system_name must match [A-Za-z0-9_]+';
  if (RESERVED_NAMES.includes(name)) return '"' + name + '" is a reserved word';
  if (existing.some((d) => d.system_name === name)) return 'a content def named "' + name + '" already exists';
  return null;
}

export function prettyJson(o: unknown): string { return JSON.stringify(o, null, 2); }

/** REQ-0164 F: 'YYYY-MM-DD HH:MM' in the operator's LOCAL timezone (the raw
 * UTC ISO was -9h off for the JST desk). Pure + unit-testable; falls back to
 * the raw slice for an unparseable value. The card/tooltip callers pass the
 * raw ISO as the title attr, so the exact UTC instant stays inspectable. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// REQ-0164 E: client-side rail sort. 'created' keeps the server order
// (created_at ASC == monotonic id ASC); 'name' is A->Z; 'activity' is
// last_variant_at DESC with nulls (never-ingested defs) last.
export type SortMode = 'created' | 'name' | 'activity';
export const SORT_MODES: SortMode[] = ['created', 'name', 'activity'];
export function sortDefs(defs: ContentDefDto[], mode: SortMode): ContentDefDto[] {
  const arr = defs.slice();
  if (mode === 'name') {
    arr.sort((a, b) => a.system_name.localeCompare(b.system_name));
  } else if (mode === 'activity') {
    arr.sort((a, b) => {
      const ta = a.last_variant_at ? Date.parse(a.last_variant_at) : NaN;
      const tb = b.last_variant_at ? Date.parse(b.last_variant_at) : NaN;
      const na = isNaN(ta), nb = isNaN(tb);
      if (na && nb) return (a.id || 0) - (b.id || 0); // both never-ingested -> created order
      if (na) return 1; // nulls last
      if (nb) return -1;
      return tb - ta; // most-recent activity first
    });
  } else {
    arr.sort((a, b) => (a.id || 0) - (b.id || 0)); // created order (default)
  }
  return arr;
}

// ---- line diff (REQ-0155 algorithm kept: positional comparison of the
// pretty-printed JSON lines; REQ-0157 only restyles the rendering) ----
export interface DiffRow { l: string; r: string; diff: boolean }
function prettyLines(o: unknown): string[] { return JSON.stringify(o, null, 1).split('\n'); }
export function diffRows(a: unknown, b: unknown): DiffRow[] {
  const la = prettyLines(a), lb = prettyLines(b);
  const n = Math.max(la.length, lb.length);
  const rows: DiffRow[] = [];
  for (let i = 0; i < n; i++) {
    const l = la[i] ?? '', r = lb[i] ?? '';
    rows.push({ l, r, diff: l !== r });
  }
  return rows;
}

// ---- ingest parse preview (gates the Ingest button) ----
export interface IngestEntry { data: Record<string, unknown>; provenance?: Record<string, unknown> }
export interface ParsePreview { state: 'idle' | 'ok' | 'err'; count: number; note: string; variants: IngestEntry[] }

/** Parse the pasted agent reply BEFORE ingest: accepts a bare array,
 * {variants:[...]} or a single {data,provenance} object (the same shapes the
 * receiving API takes). Returns the first parse/shape error instead of
 * letting the Ingest button fail blind. */
export function parseIngest(text: string): ParsePreview {
  const t = text.trim();
  if (!t) return { state: 'idle', count: 0, note: 'paste the agent reply above', variants: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(t); } catch (e) {
    return { state: 'err', count: 0, note: 'parse error: ' + (e as Error).message, variants: [] };
  }
  const p = parsed as Record<string, unknown>;
  const arr: unknown[] = Array.isArray(parsed) ? parsed
    : Array.isArray(p.variants) ? (p.variants as unknown[])
    : (p && typeof p === 'object' && p.data) ? [parsed] : [];
  if (arr.length === 0) return { state: 'err', count: 0, note: 'no variants found (expected [...], {variants:[...]} or {data,provenance})', variants: [] };
  const out: IngestEntry[] = [];
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i] as Record<string, unknown> | null;
    if (!v || typeof v !== 'object' || typeof v.data !== 'object' || v.data === null) {
      return { state: 'err', count: 0, note: 'variants[' + i + '] has no data object', variants: [] };
    }
    out.push(v as unknown as IngestEntry);
  }
  const missingProv = out.filter((v) => !v.provenance).length;
  const note = out.length + ' variant' + (out.length === 1 ? '' : 's') + ' parsed'
    + (missingProv ? ' -- WARNING: ' + missingProv + ' without provenance (server will refuse)' : ', data + provenance present');
  return { state: 'ok', count: out.length, note, variants: out };
}

/** One-click copy: navigator.clipboard needs a secure context, so a
 * select-all textarea fallback covers odd contexts (spec risk note). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }
}

/** Resolve a parent_variant_id to its variant_no for lineage display
 * ("human_edit <- v1"); falls back to the raw id when the parent was
 * deleted (variant_no is never reused, ids stay meaningful). */
export function parentLabel(v: ContentVariantDto, all: ContentVariantDto[]): string | null {
  const pid = v.provenance && v.provenance.parent_variant_id;
  if (pid == null) return null;
  const parent = all.find((x) => String(x.id) === String(pid));
  return parent ? '<- v' + parent.variant_no : '<- id ' + pid;
}

export function reviewClass(verdict: string): string {
  return verdict === 'recommend' ? 'aa-verdict--pass' : verdict === 'concern' ? 'aa-verdict--warn' : 'ca-verdict--na';
}


// ============================================================
// REQ-0173 (contentadmin-entity-rendering): pure helpers backing
// EntityPreview + the structured edit form + entity-level diff.
// Registry semantics are untouched; everything here is display/
// serialization sugar over variant.data (the game entity record).
// ============================================================

/** The house rarity CSS classes live in base.css as `.rarity.r-<Rarity>`
 * (Common/Uncommon/Rare/Relic -- capitalized). enemy/1 monster data carries
 * a LOWERCASE rarity token, so normalize the first letter to Upper for the
 * class; an unknown rarity still gets a (color-less) class -- graceful, never
 * a crash. Returns the full className string incl. the base `rarity`. */
export function rarityClass(rarity: unknown): string {
  const r = typeof rarity === 'string' && rarity ? rarity : '';
  const norm = r ? r.charAt(0).toUpperCase() + r.slice(1) : '';
  return 'rarity r-' + norm;
}

/** ShapeGrid wants a non-empty cell set; SI/TM (and any shape-less entity)
 * fall back to the synthetic 1x1 anchor cell -- the exact DexAdmin/
 * DexCardWindow precedent -- so the icon still mounts. */
export function entityShape(data: Record<string, unknown>): Cell[] {
  const shape = Array.isArray(data.shape) ? (data.shape as Cell[]) : [];
  return shape.length > 0 ? shape : ([[0, 0]] as Cell[]);
}

/** JA name/flavor from the entry's i18n.ja map (Dex reads i18n directly).
 * Falls back to the legacy top-level name_ja/flavor_ja if present. */
export function jaField(data: Record<string, unknown>, field: 'name' | 'flavor'): string {
  const i18n = data.i18n as Record<string, { name?: string; flavor?: string }> | undefined;
  const ja = i18n && i18n.ja;
  const v = ja ? ja[field] : undefined;
  if (typeof v === 'string' && v) return v;
  const legacy = data[field + '_ja'];
  return typeof legacy === 'string' ? legacy : '';
}

/** A compact, vocab-agnostic one-line rendering of one effect AST entry:
 * `trigger[lo-hi] · verb n[lo-hi] status xmult · cond/stat`. Read-only; it
 * never validates -- it just surfaces whatever fields the AST carries. Guards
 * a non-object entry (returns a raw JSON slice) so a malformed effects array
 * cannot crash the preview. */
export function effectLine(eff: unknown): string {
  if (!eff || typeof eff !== 'object' || Array.isArray(eff)) {
    return String(JSON.stringify(eff)).slice(0, 60);
  }
  const e = eff as Record<string, unknown>;
  const trg = (e.trigger as Record<string, unknown>) || {};
  const vb = (e.verb as Record<string, unknown>) || {};
  const range = (a: unknown): string => {
    if (!Array.isArray(a)) return '';
    if (a.length >= 2) return '[' + a[0] + '-' + a[1] + ']';
    if (a.length === 1) return '[' + a[0] + ']';
    return '';
  };
  const parts: string[] = [];
  const trgT = typeof trg.t === 'string' ? trg.t : '';
  if (trgT) parts.push(trgT + range(trg.s));
  let verbStr = typeof vb.t === 'string' ? vb.t : '';
  const nr = range(vb.n);
  if (nr) verbStr += ' ' + nr;
  if (typeof vb.status === 'string' && vb.status) verbStr += ' ' + vb.status;
  if (vb.mult !== undefined && vb.mult !== null && vb.mult !== '') verbStr += ' x' + vb.mult;
  if (verbStr.trim()) parts.push(verbStr.trim());
  const tail: string[] = [];
  if (typeof e.cond === 'string' && e.cond) tail.push(e.cond);
  if (typeof e.stat === 'string' && e.stat) tail.push(e.stat);
  if (tail.length) parts.push(tail.join('/'));
  return parts.join(' · ') || '(effect)';
}

/** Rail/header thumbnail URL for an artwork aggregate row: adopted render
 * (public /api/art/<name>, cache-busted by the adopted seed) -> latest ok
 * candidate -> null (caller renders a placeholder). Mirrors the artadmin
 * RegistryRail thumbUrl decision verbatim. */
export function artworkThumbUrl(a: ArtworkDto | undefined | null): string | null {
  if (!a) return null;
  if (a.adopted_render_id != null) {
    return artAdoptedUrl(a.system_name) + '?v=' + (a.adopted_seed != null ? a.adopted_seed : 'a');
  }
  if (a.latest_ok_seed != null) return artRenderUrl(a.system_name, a.latest_ok_seed);
  return null;
}

/** REQ-0173 follow-up (display-layer name reconciliation): index artworks by
 * BOTH their exact system_name AND their batch-stripped suffix (the part
 * after the last ':'). The two live backfills named their rows differently
 * (artworks: 'batch-004-item-icons-flux2:blade'; content defs: 'blade'), so
 * exact matching lights up ZERO facets on the live data. Suffix entries
 * never shadow an exact entry, and an adopted-render artwork wins a suffix
 * collision. DISPLAY-ONLY linkage: the server's has_artwork_facet
 * (exact-match) is untouched; real name reconciliation is a future
 * registry REQ. */
export function buildArtworkIndex(artworks: ArtworkDto[]): Record<string, ArtworkDto> {
  const index: Record<string, ArtworkDto> = {};
  const exact = new Set<string>();
  for (const a of artworks) { index[a.system_name] = a; exact.add(a.system_name); }
  for (const a of artworks) {
    const i = a.system_name.lastIndexOf(':');
    if (i < 0) continue;
    const suffix = a.system_name.slice(i + 1);
    if (!suffix || exact.has(suffix)) continue;
    const cur = index[suffix];
    if (!cur || (cur.adopted_render_id == null && a.adopted_render_id != null)) index[suffix] = a;
  }
  return index;
}

/** Top-level keys whose pretty-JSON value differs between two entity records
 * (either side missing counts as changed) -- backs the diff changed-field
 * chips. Stable, sorted, union of both key sets. */
export function changedTopFields(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set<string>([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const out: string[] = [];
  for (const k of Array.from(keys).sort()) {
    if (JSON.stringify(a ? a[k] : undefined) !== JSON.stringify(b ? b[k] : undefined)) out.push(k);
  }
  return out;
}
