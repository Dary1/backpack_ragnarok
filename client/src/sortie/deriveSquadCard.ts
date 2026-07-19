// client/src/sortie/deriveSquadCard.ts -- REQ-0239 (design 01 sec 6.2/6.3): the
// pure per-squad card-state derivation for the sortie shelf + troop slots. Turns
// (squad info, the current troop assignment, conflict primitives) into the
// display props SquadMiniCard renders. The 3-layer shared-unit legibility lives
// here: passive link badge, active red conflict strip, mirrored lockout copy.
import { t, type TranslationKey } from '../i18n';
import type { Locale } from '../store';
import type { SquadStateKey } from './stateChip';
import type { SquadConflicts, SquadInfo } from './useSquadConflicts';

const ORD_KEYS: readonly TranslationKey[] = [
  'schedule.room.ord1', 'schedule.room.ord2', 'schedule.room.ord3', 'schedule.room.ord4',
];

export interface SquadCardEntry {
  info: SquadInfo;
  stateKey: SquadStateKey;
  assignable: boolean;
  assignedSlot: number | null;
  assignedOrdinal: string | null;
  conflicted: boolean;
  conflictStrip: string | null;
  conflictTooltip: string | null;
  blocksStrip: string | null;
  showSharedBadge: boolean;
  deployedDungeonName: string | null;
  freesLabel: string | null;
}

function timeOf(iso: string | null, locale: Locale): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString(locale === 'ja' ? 'ja-JP' : 'en-US', { hour: '2-digit', minute: '2-digit' });
}

/** Derive one squad's card entry for the current troop. `assigned` is the 4-slot
 * array (squadIndex | null); `dungeonNameFor` resolves a room's dungeonId. */
export function deriveSquadCard(
  locale: Locale,
  info: SquadInfo,
  conflicts: SquadConflicts,
  assigned: (number | null)[],
  dungeonNameFor: (dungeonId: string) => string,
): SquadCardEntry {
  const base: SquadCardEntry = {
    info,
    stateKey: 'ready',
    assignable: false,
    assignedSlot: null,
    assignedOrdinal: null,
    conflicted: false,
    conflictStrip: null,
    conflictTooltip: null,
    blocksStrip: null,
    showSharedBadge: info.sharedBadgeCount > 0,
    deployedDungeonName: null,
    freesLabel: null,
  };

  // 1) Assigned to a troop slot -> gold ring + ordinal; click unassigns. The
  //    mirrored lockout copy (rule 3) reads off the assigned card too.
  const assignedSlot = assigned.findIndex((idx) => idx === info.index);
  if (assignedSlot >= 0) {
    const blockedNames = conflicts.squads
      .filter((o) => o.index !== info.index && conflicts.sharedBetween(info.index, o.index).count > 0)
      .map((o) => o.name);
    return {
      ...base,
      stateKey: 'ready',
      assignedSlot,
      assignedOrdinal: t(locale, ORD_KEYS[assignedSlot] ?? ORD_KEYS[0]),
      blocksStrip: blockedNames.length ? t(locale, 'sortie.squad.conflictBlocks', { squads: blockedNames.join('、') }) : null,
      showSharedBadge: false,
    };
  }

  // 2) No Backpack -> undeployable.
  if (!info.deployable || info.bpCount === 0) {
    return { ...base, stateKey: 'undeployable', conflictTooltip: t(locale, 'sortie.squad.undeployable') };
  }

  // 3) Out on an active expedition -> deployed, not assignable.
  if (info.deployment?.kind === 'active') {
    const dungeon = dungeonNameFor(info.deployment.dungeonId);
    return {
      ...base,
      stateKey: 'deployed',
      deployedDungeonName: t(locale, 'sortie.squad.deployedIn', { dungeon }),
      freesLabel: info.deployment.freesAtIso ? t(locale, 'sortie.squad.freesAt', { time: timeOf(info.deployment.freesAtIso, locale) }) : null,
      conflictTooltip: t(locale, 'sortie.squad.deployedIn', { dungeon }),
    };
  }

  // 4) Recovering (cooldown) -> not assignable (client courtesy; server allows).
  if (info.deployment?.kind === 'cooldown') {
    const dungeon = dungeonNameFor(info.deployment.dungeonId);
    return {
      ...base,
      stateKey: 'recovering',
      deployedDungeonName: t(locale, 'sortie.squad.recoveringIn', { dungeon }),
      freesLabel: info.deployment.freesAtIso ? t(locale, 'sortie.squad.freesAt', { time: timeOf(info.deployment.freesAtIso, locale) }) : null,
      conflictTooltip: t(locale, 'sortie.squad.recoveringIn', { dungeon }),
    };
  }

  // 5) Conflicts with an ASSIGNED squad -> red strip naming item + partner squad.
  for (const slotIdx of assigned) {
    if (slotIdx == null || slotIdx === info.index) continue;
    const shared = conflicts.sharedBetween(info.index, slotIdx);
    if (shared.count > 0) {
      const partner = conflicts.squads.find((s) => s.index === slotIdx);
      const itemName = shared.unitNames.length ? shared.unitNames.join('、') : String(shared.count);
      return {
        ...base,
        stateKey: 'ready',
        conflicted: true,
        conflictStrip: t(locale, 'sortie.squad.conflict', { item: itemName, n: shared.count, squad: partner?.name ?? '' }),
        conflictTooltip: t(locale, 'sortie.squad.conflict', { item: itemName, n: shared.count, squad: partner?.name ?? '' }),
        showSharedBadge: false,
      };
    }
  }

  // 6) Ready -> assignable.
  return { ...base, stateKey: 'ready', assignable: true };
}
