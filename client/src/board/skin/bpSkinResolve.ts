// client/src/board/skin/bpSkinResolve.ts -- REQ-0126, extended REQ-0266 (D-C).
// THE resolution chain answering "which skin does this BP wear?" -- the sibling
// of unitIcon.ts's resolveUnitIcon (REQ-0125a), which cites it. Chain:
//   BP-instance skin slot -> the PLAYER's pick for this BP's unit
//                         -> the def-declared default for this BP's unit
//                         -> neutral default -> plain
// REQ-0266 inserted the `profile` rung: /api/profile/:id/skins carries only the
// player's EXPLICIT picks (server/storage/skin_prefs.cjs's resolveSkinPrefs
// filters, it never injects defaults), so `profile` and `set` are genuinely two
// different questions and stay two different rungs. Absence at every level --
// no file, no unit key, a null value, a skin id that no longer exists -- falls
// through to the def default, exactly as ruling D5 requires.
// A rung is taken only if declared (non-empty id) AND available (`has(id)`).
// Declared-but-unavailable = missing-skin case -> falls through silently:
// "missing art never blocks rendering". Neutral is always registered, so a real
// BP lands on neutral at worst; plain (skinId null) is the defensive floor.
// A BP with no `unit` has nothing to key on and lands on neutral, as it always
// has -- the caller simply passes neither profile nor set id.
// Pure. Total. Never throws.
import { NEUTRAL_ID } from "./skinRegistry";
export type BpSkinRung = "instance" | "profile" | "set" | "neutral" | "plain";
export interface BpSkinQuery {
  instanceSkinId?: string | null;
  /** REQ-0266: the player's own pick for this BP's unit, bpskin slot. */
  profileSkinId?: string | null;
  unitSetSkinId?: string | null;
}
export type HasSkin = (id: string) => boolean;
export interface BpSkinResolution { rung: BpSkinRung; skinId: string | null; }
export function resolveBpSkin(query: BpSkinQuery, has: HasSkin, neutralId: string = NEUTRAL_ID): BpSkinResolution {
  const rungs: ReadonlyArray<readonly [BpSkinRung, string | null | undefined]> = [
    ["instance", query.instanceSkinId], ["profile", query.profileSkinId],
    ["set", query.unitSetSkinId], ["neutral", neutralId],
  ];
  for (const [rung, id] of rungs) { if (typeof id === "string" && id.length > 0 && has(id)) return { rung, skinId: id }; }
  return { rung: "plain", skinId: null };
}
