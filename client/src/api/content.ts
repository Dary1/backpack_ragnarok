// client/src/api/content.ts -- REQ-0145b (ca): /api/content fetch + the
// wire-payload -> engine-ready GameData normalization + boot-time
// resolution (extracted VERBATIM from the old flat api.ts; see api.ts,
// now the barrel, for the module history).
import { getJSON } from './http';
import type { ConnShapeMap, GameState, ItemDefMap, Layout, SIDefMap, Trees, UnitDefMap, UnitSkinMap } from '../engine/engine.d.ts';
import type { ApiContentPayload, ApiPackEntry, ApiScenario, ApiStarterUnits } from '../../../shared/dto';
import { loadSkinDefs, type BpSkinDef } from '../board/skin/skinRegistry'; // REQ-0180
import { loadUnitSkinDefs } from '../board/skin/unitSkinRegistry'; // REQ-0180
import { fetchCanvas } from './profile';

// ---- engine-ready shape (what Engine.create(...) + makeState() consume) ----

export interface GameData {
  LAYOUT: Layout;
  ITEMS: ItemDefMap;
  SI_DEFS: SIDefMap;
  TREES: Trees;
  /** REQ-0170: the unit/1 defs. Engine.create() resolves every BP's rays through
   * these + CONN_SHAPES, so the def -- not the BP -- is the source of truth. */
  UNITS: UnitDefMap;
  /** REQ-0170: vocab.json's connection_shapes table. */
  CONN_SHAPES: ConnShapeMap;
  /** REQ-0170: the gacha packs, id-keyed. */
  PACKS: Record<string, ApiPackEntry>;
  /** REQ-0133: registry-first item art. id -> resolved adopted-render URL
   * (`/api/art/<artwork>.png`). Sparse; an absent id falls back to its SVG
   * sprite icon. Handed to board/itemArt.setItemArtUrls() at boot. */
  ART_URLS: Record<string, string>;
  /** REQ-0180: bpskin/1 defs, id-keyed (loadSkinDefs of payload.bpskins). The
   * silhouette compositor + resolveBpSkin's has() read these. */
  SKINS: Record<string, BpSkinDef>;
  /** REQ-0180: unit_skin/1 SET ledger, key-keyed; each pairs art_unit + bpskin. */
  UNIT_SKINS: UnitSkinMap;
  makeState: () => GameState;
  starterUnits: ApiStarterUnits | null; // REQ-0051: fresh-profile starter-unit seed source
}

/** GET /api/content. Throws ApiError on network failure or non-2xx. No
 * auth needed -- content is public read data, same as before REQ-0037. */
export function fetchContent(): Promise<ApiContentPayload> {
  return getJSON<ApiContentPayload>('/api/content');
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
      ...(e.align ? { align: e.align } : {}),
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

  // REQ-0170: units + shapes + packs pass through as-is (already id-keyed by the
  // server, and unlike items/SIs a unit def carries no effects AST to render).
  const UNITS: UnitDefMap = (payload.units ?? {}) as unknown as UnitDefMap;
  const CONN_SHAPES: ConnShapeMap = (payload.connection_shapes ?? {}) as unknown as ConnShapeMap;
  const PACKS: Record<string, ApiPackEntry> = payload.packs ?? {};
  // REQ-0133: the server-resolved registry-first art URLs (additive, sparse).
  const ART_URLS: Record<string, string> = payload.art_urls ?? {};
  // REQ-0180: bpskin/1 defs + unit_skin/1 SET ledger, validated + id-keyed here
  // (same normalization seam as UNITS/ITEMS). Tolerant: an older server without
  // these fields yields empty maps and the boards render plain.
  const SKINS: Record<string, BpSkinDef> = loadSkinDefs(payload.bpskins ?? { entries: [] });
  const UNIT_SKINS: UnitSkinMap = loadUnitSkinDefs(payload.unit_skins ?? { entries: [] });

  const scenarioForState: Partial<ApiScenario> = JSON.parse(JSON.stringify(payload.scenario ?? {}));
  delete scenarioForState.layout;
  const scenarioClone = scenarioForState as GameState;

  function makeState(): GameState {
    return JSON.parse(JSON.stringify(scenarioClone));
  }

  return { LAYOUT, ITEMS, SI_DEFS, TREES, UNITS, CONN_SHAPES, PACKS, ART_URLS, SKINS, UNIT_SKINS, makeState, starterUnits: payload.starterUnits ?? null };
}

export type DataSource = 'live' | 'error';

export interface ResolvedGameData {
  source: DataSource;
  gameData: GameData | null;
  error?: string;
  /** REQ-0042: true iff GET /api/profile/:id/canvas 404'd (no saved
   * canvas existed for this player yet) -- i.e. this is a GENUINELY
   * fresh profile, never saved before. store.ts's boot() uses this
   * (and ONLY this -- never re-checked on any later boot, since a
   * fresh profile's first save makes canvasDoc.canvas truthy forever
   * after) to seed a one-time starter LRDST stack, exactly once, on a
   * brand new profile -- see boot()'s own comment for why this is the
   * correct, safe hook (never re-fires for an existing save, including
   * the dev player's, which already has a saved profile from long
   * before this REQ existed). */
  isFreshProfile: boolean;
}

/**
 * Resolves GameData: always live (per REQ-0026 T0.1 scope -- no baked-data
 * fallback in the client; that offline-first behavior belongs to the
 * mock, per mock-src/ui.js). On failure, returns source:'error' so the UI
 * can show an explicit error state instead of silently rendering nothing.
 * Canvas resolution: GET /api/profile/:profileId/canvas; on 404 (no saved
 * canvas yet) falls back to the content payload's baked `scenario`, per
 * the spec's "saved profile (fallback scenario)" instruction.
 *
 * REQ-0037: `profileId` is the AUTHENTICATED player's own playerId
 * (resolved via /api/me -- see store.ts's boot(), which calls fetchMe()
 * first and passes its playerId here), not a hardcoded 'default' string
 * -- so different logged-in guests get isolated boards. A caller with no
 * stored token still gets a working profileId because /api/me itself
 * resolves to the dev player under dev_mode, and store.ts uses THAT
 * playerId here, not a literal 'default'.
 */
export async function resolveGameData(profileId: string): Promise<ResolvedGameData> {
  try {
    const content = await fetchContent();
    const gameData = gameDataFromApiContent(content);
    const canvasDoc = await fetchCanvas(profileId).catch(() => null);
    if (canvasDoc?.canvas) {
      const canvas = canvasDoc.canvas;
      gameData.makeState = () => JSON.parse(JSON.stringify(canvas));
    }
    return { source: 'live', gameData, isFreshProfile: !canvasDoc?.canvas };
  } catch (e) {
    return { source: 'error', gameData: null, error: e instanceof Error ? e.message : String(e), isFreshProfile: false };
  }
}
