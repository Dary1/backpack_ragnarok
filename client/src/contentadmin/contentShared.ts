// client/src/contentadmin/contentShared.ts -- REQ-0157. Shared types + pure
// helpers for the content-admin components (page split out of the REQ-0155
// single-file ContentAdminPage, mirroring the artadmin/artShared.ts pattern
// of REQ-0156). Registry semantics live on the server; everything here is
// display/validation sugar only.
// REQ-0164 (contentadmin-ux-r2): fmtDate now renders LOCAL time (title attr
// keeps the raw ISO), a kind-driven schema_ref default map replaces the flat
// placeholder, and a client-side def sort helper backs the rail sort control.
import type { ContentDefDto, ContentVariantDto } from '../api';

export type Kind = 'po_def' | 'si_def' | 'monster_def' | 'unit_def' | 'tm_def' | 'skill_def';
export const KINDS: Kind[] = ['po_def', 'si_def', 'monster_def', 'unit_def', 'tm_def', 'skill_def'];

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
  unit_def: 'content/vocab.json',
};
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
