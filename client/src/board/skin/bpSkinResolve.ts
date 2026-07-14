// client/src/board/skin/bpSkinResolve.ts -- REQ-0126. THE resolution chain
// answering "which skin does this BP wear?" -- the sibling of unitIcon.ts's
// resolveUnitIcon (REQ-0125a), which cites it. Chain (pipeline §6, spec item 3):
//   BP-instance skin slot -> Unit's set skin -> neutral default -> plain
// A rung is taken only if declared (non-empty id) AND available (`has(id)`).
// Declared-but-unavailable = missing-skin case -> falls through silently:
// "missing art never blocks rendering". Neutral is always registered, so a real
// BP lands on neutral at worst; plain (skinId null) is the defensive floor.
// Pure. Total. Never throws.
import { NEUTRAL_ID } from "./skinRegistry";
export type BpSkinRung = "instance" | "set" | "neutral" | "plain";
export interface BpSkinQuery { instanceSkinId?: string | null; unitSetSkinId?: string | null; }
export type HasSkin = (id: string) => boolean;
export interface BpSkinResolution { rung: BpSkinRung; skinId: string | null; }
export function resolveBpSkin(query: BpSkinQuery, has: HasSkin, neutralId: string = NEUTRAL_ID): BpSkinResolution {
  const rungs: ReadonlyArray<readonly [BpSkinRung, string | null | undefined]> = [
    ["instance", query.instanceSkinId], ["set", query.unitSetSkinId], ["neutral", neutralId],
  ];
  for (const [rung, id] of rungs) { if (typeof id === "string" && id.length > 0 && has(id)) return { rung, skinId: id }; }
  return { rung: "plain", skinId: null };
}
