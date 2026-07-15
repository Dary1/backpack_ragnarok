// client/src/artadmin/artShared.ts -- REQ-0156. Shared types + pure helpers
// for the artwork-admin components (page split out of the REQ-0151
// single-file ArtAdminPage). The sizing derivation MUST keep mirroring
// server/services/art_sizing.cjs (the sizing law is server-owned and
// read-only; this copy only powers the live resolution display).
import type { ArtworkDto } from '../api';

export type Kind = 'po' | 'si' | 'unit' | 'monster' | 'bpskin' | 'custom';
export const KINDS: Kind[] = ['po', 'si', 'unit', 'monster', 'bpskin', 'custom'];

// REQ-0179: ComfyUI flux2-latent max (mirror of art_sizing.cjs MAX_RESOLUTION).
export const MAX_RES = 16384;

// Mirror of routes/art.cjs RESERVED (path segments the public serving GET
// owns) -- checked client-side for instant feedback; the server re-checks.
export const RESERVED_NAMES = ['artworks', 'dev', 'meta', 'renders', 'queue'];

export function snap16(v: number): number { return Math.max(16, Math.round(v / 16) * 16); }
/** REQ-0179: clamp a /16-snapped custom dimension to ComfyUI's latent max. */
export function clampRes(v: number): number { return Math.min(MAX_RES, v); }
export function emptyMask(): boolean[][] { return Array.from({ length: 5 }, () => Array(5).fill(false) as boolean[]); }
export function maskCellCount(mask: boolean[][]): number {
  let n = 0;
  for (const row of mask) for (const v of row) if (v) n++;
  return n;
}

/** Client mirror of the sizing law (art_sizing.cjs): po bounding box at
 * 256/cell, monster w*h at 128/cell, /16 snap; si 256, unit 512, bpskin
 * 1024 locked. Must reproduce the ratified examples (sword 3 vertical
 * cells -> 256x768 etc.). */
export function deriveSizeClient(kind: Kind, mask: boolean[][], mw: number, mh: number, cw = 1024, ch = 1024): { width: number; height: number } {
  if (kind === 'si') return { width: 256, height: 256 };
  if (kind === 'unit') return { width: 512, height: 512 };
  if (kind === 'bpskin') return { width: 1024, height: 1024 };
  if (kind === 'custom') return { width: clampRes(snap16(cw)), height: clampRes(snap16(ch)) };
  if (kind === 'monster') return { width: snap16(mw * 128), height: snap16(mh * 128) };
  let minR = 5, maxR = -1, minC = 5, maxC = -1;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (mask[r][c]) {
    minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c);
  }
  if (maxR < 0) return { width: 0, height: 0 };
  return { width: snap16((maxC - minC + 1) * 256), height: snap16((maxR - minR + 1) * 256) };
}

export function defaultTemplate(kind: Kind): string {
  if (kind === 'po' || kind === 'si') return '{main_object}, white background, bold outline';
  if (kind === 'unit') return '{main_object}, portrait, looking at viewer, white background';
  if (kind === 'monster') return '{main_object}, white background';
  if (kind === 'custom') return '{main_object}';
  return '';
}

/** Live create-form name validation: regex, reserved words, duplicates
 * against the loaded registry. Returns an error string or null when OK. */
export function validateNewName(name: string, existing: ArtworkDto[]): string | null {
  if (!name) return null; // empty handled by the disabled Create button
  if (!/^[A-Za-z0-9_]+$/.test(name)) return 'name must match [A-Za-z0-9_]+';
  if (RESERVED_NAMES.includes(name)) return '"' + name + '" is a reserved word';
  if (existing.some((a) => a.system_name === name)) return 'an artwork named "' + name + '" already exists';
  return null;
}

/** Batch-prefix of backfilled `prefix:name` entries, or null for plain
 * admin-created names (which can never contain ':', the namespace/batch
 * separator). */
export function batchPrefix(name: string): string | null {
  const i = name.indexOf(':');
  return i > 0 ? name.slice(0, i) : null;
}

/** mm:ss (or h:mm:ss) for the queue panel's live elapsed timer. */
export function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? h + ':' + two(m) + ':' + two(sec) : m + ':' + two(sec);
}

/** The editable-field draft the center workspace works on (explicit Save;
 * never silently PATCHed). Shape drafts ride along for po/monster. */
/** REQ-0186: the po shape-conditioning locks, weakest -> strongest. The blurbs
 * are REQ-0153's MEASURED numbers, not adjectives: the operator is choosing
 * between arms that were actually scored. */
export const SHAPE_LOCKS = ['auto', 'off', 'guide', 'strict'] as const;
export type ShapeLock = typeof SHAPE_LOCKS[number];
export const SHAPE_LOCK_HELP: Record<ShapeLock, string> = {
  auto: 'default - strict on a shape that does not fill its box (L, T), off on one that does (1x3, 2x2)',
  off: 'no shape conditioning; the subject composes freely (28% fit)',
  guide: 'scaffold guides composition, no hard edge; may spill past the cells (60% fit)',
  strict: 'nothing renders outside the cells (100% fit), at some subject legibility',
};
export const MAX_DILATION_PX = 16;

export interface ArtDraft {
  main_object: string;
  prompt_template: string;
  style_override: string;
  edge_padding: number;
  shape_lock: ShapeLock;
  shape_dilation_px: number;
  mask: boolean[][];
  mw: number;
  mh: number;
  cw: number;
  ch: number;
}

export function draftFromArtwork(a: ArtworkDto): ArtDraft {
  const sh = (a.shape || {}) as { mask?: boolean[][]; w?: number; h?: number; width?: number; height?: number };
  return {
    main_object: a.main_object || '',
    prompt_template: a.prompt_template || '',
    style_override: a.style_override || '',
    edge_padding: a.edge_padding != null ? a.edge_padding : 32,
    shape_lock: (a.shape_lock as ShapeLock) || 'auto',
    shape_dilation_px: a.shape_dilation_px != null ? a.shape_dilation_px : 8,
    mask: a.kind === 'po' && sh.mask ? sh.mask.map((r) => r.slice()) : emptyMask(),
    mw: a.kind === 'monster' && sh.w ? sh.w : 3,
    mh: a.kind === 'monster' && sh.h ? sh.h : 4,
    cw: a.kind === 'custom' && sh.width ? sh.width : (a.gen_width || 1024),
    ch: a.kind === 'custom' && sh.height ? sh.height : (a.gen_height || 1024),
  };
}
