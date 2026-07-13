// client/src/contentadmin/contentShared.ts -- REQ-0157. Shared types + pure
// helpers for the content-admin components (page split out of the REQ-0155
// single-file ContentAdminPage, mirroring the artadmin/artShared.ts pattern
// of REQ-0156). Registry semantics live on the server; everything here is
// display/validation sugar only.
import type { ContentDefDto, ContentVariantDto } from '../api';

export type Kind = 'po_def' | 'si_def' | 'monster_def' | 'unit_def' | 'tm_def';
export const KINDS: Kind[] = ['po_def', 'si_def', 'monster_def', 'unit_def', 'tm_def'];

// Mirror of routes/content.cjs RESERVED (path segments the public serving
// GET owns) -- checked client-side for instant feedback; the server
// re-checks on POST.
export const RESERVED_NAMES = ['defs', 'dev', 'meta'];

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

/** 'YYYY-MM-DD HH:MM' for variant cards / rail tooltips. */
export function fmtDate(iso: string | null | undefined): string {
  return (iso || '').slice(0, 16).replace('T', ' ');
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
