// Typed API client — REQ-0026 T0.1.
// Talks to server/api.cjs: GET /api/content, GET/PUT /api/profile/:id/canvas.
// Mirrors the ACTUAL live response shapes (inspected via
// `curl https://backpack-dev.qtie.jp/api/content` and .../profile/default/canvas
// during T0.1 implementation) -- not a guess from the spec doc. The
// normalization from raw wire payload -> engine-ready GameData is a direct
// TypeScript port of mock-src/ui.js's gameDataFromApiContent(): same fields,
// same defaulting rules, now typed. This is glue/data-shaping code, not
// engine logic -- Engine.create() itself is untouched (see engine/adapter.ts).
import type { GameState, ItemDefMap, Layout, SIDefMap, Trees } from './engine/engine.d.ts';

// ---- raw wire shapes (as served by server/api.cjs's buildContentPayload) ----

/** Effect AST node -- opaque to the client; only eff_en/eff_ja (server-
 * rendered display text) are consumed. Kept as unknown[] rather than typed
 * out, since T0.1 never inspects the AST itself (tools/eff_render.cjs on the
 * server already renders it into eff_en/eff_ja before the client sees it). */
export type EffectAst = unknown;

export interface ApiSocketDef {
  t: string;
  tags?: string[];
  ax?: number;
  ay?: number;
}

export interface ApiPortDef {
  tiles: Array<[number, number]>;
  tag: string;
}

export interface ApiItemEntry {
  id: string;
  name: string;
  name_ja?: string;
  tags: string[];
  rarity: string;
  shape: Array<[number, number]>;
  icon: string;
  sockets?: ApiSocketDef[];
  ports?: ApiPortDef[];
  stretch?: boolean;
  part?: { assembles: string; role: string };
  effects?: EffectAst[];
  flavor?: string;
  flavor_ja?: string;
  eff_en?: string;
  eff_ja?: string;
}

export interface ApiSIEntry {
  id: string;
  name: string;
  name_ja?: string;
  slot: string;
  reqTags?: string[];
  icon: string;
  rarity: string;
  ports?: ApiPortDef[];
  effects?: EffectAst[];
  flavor?: string;
  flavor_ja?: string;
  eff_en?: string;
  eff_ja?: string;
}

export interface ApiTrees {
  po: Record<string, string | null>;
  socket: Record<string, string | null>;
}

/** scenario.json shape: the baked default canvas, plus `layout` (stripped
 * off before use as GameState -- see gameDataFromApiContent below, matching
 * ui.js's `delete scenarioForState.layout`). */
export interface ApiScenario extends GameState {
  layout?: Layout;
}

export interface ApiContentPayload {
  items: Record<string, ApiItemEntry>;
  sis: Record<string, ApiSIEntry>;
  trees: ApiTrees;
  scenario: ApiScenario;
  layout: Layout | null;
}

export interface ApiCanvasDoc {
  schema_version: number;
  profile_id: string;
  updated_at: string;
  canvas: GameState;
}

export interface ApiErrorBody {
  ok: false;
  error: string;
}

// ---- engine-ready shape (what Engine.create(...) + makeState() consume) ----

export interface GameData {
  LAYOUT: Layout;
  ITEMS: ItemDefMap;
  SI_DEFS: SIDefMap;
  TREES: Trees;
  makeState: () => GameState;
}

export class ApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status} for ${path}`, res.status);
  }
  return (await res.json()) as T;
}

/** GET /api/content. Throws ApiError on network failure or non-2xx. */
export function fetchContent(): Promise<ApiContentPayload> {
  return getJSON<ApiContentPayload>('/api/content');
}

/**
 * GET /api/profile/:id/canvas. Returns null on 404 (no saved canvas yet --
 * NOT an error state; callers should fall back to the content payload's
 * baked `scenario`), throws ApiError on any other failure.
 */
export async function fetchCanvas(profileId: string): Promise<ApiCanvasDoc | null> {
  const res = await fetch(`/api/profile/${encodeURIComponent(profileId)}/canvas`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new ApiError(`HTTP ${res.status} for /api/profile/${profileId}/canvas`, res.status);
  }
  return (await res.json()) as ApiCanvasDoc;
}

/**
 * Converts the /api/content payload into the engine-ready GameData shape --
 * a typed port of mock-src/ui.js's gameDataFromApiContent(). Field-for-field
 * identical defaulting: eff falls back to eff_en, TREES defaults to
 * {po:{},socket:{}} (degenerate/exact-match only), scenario's `layout` key
 * is stripped before use as the makeState() template (layout is carried
 * separately as GameData.LAYOUT).
 */
export function gameDataFromApiContent(payload: ApiContentPayload): GameData {
  const LAYOUT = payload.layout ?? payload.scenario?.layout;
  if (!LAYOUT || !Number.isInteger(LAYOUT.ROWS) || !Number.isInteger(LAYOUT.COLS)) {
    throw new Error('content: missing layout');
  }

  const ITEMS: ItemDefMap = {};
  for (const id in payload.items) {
    const e = payload.items[id];
    ITEMS[id] = {
      name: e.name,
      name_ja: e.name_ja,
      tags: e.tags,
      rarity: e.rarity,
      shape: e.shape,
      icon: e.icon,
      sockets: (e.sockets ?? []).map((s) => ({ t: s.t, tags: s.tags ?? [], ax: s.ax, ay: s.ay })),
      eff: e.eff_en ?? '',
      eff_en: e.eff_en ?? '',
      eff_ja: e.eff_ja ?? '',
      flavor: e.flavor,
      flavor_ja: e.flavor_ja,
      ...(e.stretch ? { stretch: e.stretch } : {}),
      ...(e.ports !== undefined ? { ports: e.ports } : {}),
    };
  }

  const SI_DEFS: SIDefMap = {};
  for (const id in payload.sis) {
    const e = payload.sis[id];
    SI_DEFS[id] = {
      name: e.name,
      name_ja: e.name_ja,
      slot: e.slot,
      reqTags: e.reqTags ?? [],
      icon: e.icon,
      rarity: e.rarity,
      eff: e.eff_en ?? '',
      eff_en: e.eff_en ?? '',
      eff_ja: e.eff_ja ?? '',
      flavor: e.flavor,
      flavor_ja: e.flavor_ja,
      ...(e.ports !== undefined ? { ports: e.ports } : {}),
    };
  }

  const TREES: Trees = payload.trees ?? { po: {}, socket: {} };

  const scenarioForState: Partial<ApiScenario> = JSON.parse(JSON.stringify(payload.scenario ?? {}));
  delete scenarioForState.layout;
  const scenarioClone = scenarioForState as GameState;

  function makeState(): GameState {
    return JSON.parse(JSON.stringify(scenarioClone));
  }

  return { LAYOUT, ITEMS, SI_DEFS, TREES, makeState };
}

export type DataSource = 'live' | 'error';

export interface ResolvedGameData {
  source: DataSource;
  gameData: GameData | null;
  error?: string;
}

/**
 * Resolves GameData for T0.1: always live (per REQ-0026 T0.1 scope -- no
 * baked-data fallback in the client; that offline-first behavior belongs to
 * the mock, per mock-src/ui.js). On failure, returns source:'error' so the
 * UI can show an explicit error state instead of silently rendering nothing.
 * Canvas resolution: GET /api/profile/default/canvas; on 404 (no saved
 * canvas yet) falls back to the content payload's baked `scenario`, per the
 * spec's "saved profile (fallback scenario)" instruction.
 */
export async function resolveGameData(profileId = 'default'): Promise<ResolvedGameData> {
  try {
    const content = await fetchContent();
    const gameData = gameDataFromApiContent(content);
    const canvasDoc = await fetchCanvas(profileId).catch(() => null);
    if (canvasDoc?.canvas) {
      const canvas = canvasDoc.canvas;
      gameData.makeState = () => JSON.parse(JSON.stringify(canvas));
    }
    return { source: 'live', gameData };
  } catch (e) {
    return { source: 'error', gameData: null, error: e instanceof Error ? e.message : String(e) };
  }
}
