// client/src/api/skins.ts -- REQ-0266 (item 24): the per-profile skin selection
// fetch. Modelled on profile.ts's fetchCanvas -- same authHeaders(), same
// encodeURIComponent, same "404 is not an error" posture.
//
// Ruling D5 is that ABSENCE IS THE DEFAULT: no migration ever wrote a skin row,
// so a profile with no selection is the NORMAL case and must cost nothing. This
// function therefore NEVER throws and NEVER rejects -- a 404, a 401, a network
// failure, a malformed body, and an older server with no such route all resolve
// to empty prefs, and every unit falls back to its def-declared default exactly
// as if the player had picked nothing. Boot must not be blockable by a cosmetic.
import { authHeaders } from './http';
import type { UnitSkinPrefs } from '../board/unitIcon';

function normalize(raw: unknown): UnitSkinPrefs {
  const skins = (raw as { skins?: unknown })?.skins as { unit?: unknown; bpskin?: unknown } | undefined;
  if (!skins || typeof skins !== 'object') return { unit: {}, bpskin: {} };
  const pick = (v: unknown): Record<string, string | null> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string | null>) : {};
  return { unit: pick(skins.unit), bpskin: pick(skins.bpskin) };
}

/** GET /api/profile/:id/skins -> {ok, skins:{unit:{},bpskin:{}}}. Total. */
export async function fetchSkinPrefs(profileId: string): Promise<UnitSkinPrefs> {
  try {
    const res = await fetch(`/api/profile/${encodeURIComponent(profileId)}/skins`, { headers: authHeaders() });
    if (!res.ok) return { unit: {}, bpskin: {} };
    return normalize(await res.json());
  } catch {
    return { unit: {}, bpskin: {} };
  }
}
