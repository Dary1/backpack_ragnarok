// client/src/sortie/SortiePage.tsx -- REQ-0239 (design 01): the dedicated
// #/sortie route. Two visual phases on ONE page: Destination (gallery +
// dossier) and Muster (troop slots + squad shelf), with a sticky launch bar.
// Owns the fetches (dungeons / rooms / me), the selection state, and the
// atomic launch (POST /api/schedule/sorties, REQ-0239 D1).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createSortie,
  fetchDungeons,
  fetchMe,
  fetchRooms,
  hostTroop,
  joinTroop,
  type ApiDungeonsPayload,
  type ApiMe,
  type ApiRoom,
} from '../api';
import { friendlyScheduleError } from '../schedule/errors';
import { t } from '../i18n';
import { localizedName } from '../lib/contentName';
import { clearSortieFocusDungeonId, notifyStateChanged, setRoute, snapshot as storeSnapshot, useGameStore, type Locale } from '../store';
import { LaunchBar } from './LaunchBar';
import { SquadShelf } from './SquadShelf';
import { TroopSlots } from './TroopSlots';
import { LevelStepper } from './LevelStepper';
import { deriveSquadCard, type SquadCardEntry } from './deriveSquadCard';
import { readSortieAttackLv, writeSortieAttackLv } from './sortiePrefs'; // REQ-0371
import { AdvancedFold, type SortieAdvanced } from './AdvancedFold';
import { useSquadConflicts } from './useSquadConflicts';

interface SortiePageProps {
  locale: Locale;
  focusDungeonId: string | null;
}

const EMPTY_TROOP: (number | null)[] = [null, null, null, null];

export function SortiePage({ locale, focusDungeonId }: SortiePageProps) {
  const [dungeons, setDungeons] = useState<ApiDungeonsPayload | null>(null);
  const [rooms, setRooms] = useState<ApiRoom[] | null>(null);
  const [me, setMe] = useState<ApiMe | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // REQ-0371: seed attackLv from the last-used value persisted in the canvas
  // doc (sortiePrefs.ts, the REQ-0141 state.guide precedent) instead of a
  // bare 1 every visit. The effect below re-seeds once the saved canvas
  // arrives after a deep-link boot -- but never over a value the player has
  // already touched this visit.
  const gameState = useGameStore().state;
  const [level, setLevelRaw] = useState(() => readSortieAttackLv(gameState) ?? 1);
  const levelTouched = useRef(false);
  const setLevel = useCallback((n: number) => { levelTouched.current = true; setLevelRaw(n); }, []);
  useEffect(() => {
    if (levelTouched.current) return;
    const saved = readSortieAttackLv(gameState);
    if (saved != null) setLevelRaw(saved);
  }, [gameState]);
  const [formationId, setFormationId] = useState('');
  const [assigned, setAssigned] = useState<(number | null)[]>(EMPTY_TROOP);
  const [advanced, setAdvanced] = useState<SortieAdvanced>({ cancelImmediate: false, genSeed: '' });

  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const loadDungeons = useCallback(() => {
    setLoadError(null);
    fetchDungeons().then(setDungeons).catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    loadDungeons();
    fetchRooms().then((r) => setRooms(r.rooms)).catch(() => setRooms([]));
    fetchMe().then(setMe).catch(() => setMe(null));
  }, [loadDungeons]);

  // REQ-0304: the player no longer PICKS a dungeon -- the server draws one from
  // { levelMin <= attackLv } on entry. Consume any legacy #/sortie/<id> deep-link
  // focus so the old id-carrying route still resolves cleanly to the sortie page.
  useEffect(() => {
    if (focusDungeonId) clearSortieFocusDungeonId();
  }, [focusDungeonId]);

  // Default formation once dungeons load (still needed for the formation select + name lookup).
  useEffect(() => {
    if (dungeons && !formationId && dungeons.formations.length > 0) setFormationId(dungeons.formations[0].id);
  }, [dungeons, formationId]);

  const conflicts = useSquadConflicts(rooms);
  const dungeonNameFor = useCallback((dungeonId: string): string => {
    const entry = dungeons?.dungeons.find((d) => d.id === dungeonId);
    return entry ? localizedName(locale, entry) : t(locale, 'schedule.dungeonUnknown');
  }, [dungeons, locale]);

  const entries: SquadCardEntry[] = useMemo(
    () => conflicts.squads.map((info) => deriveSquadCard(locale, info, conflicts, assigned, dungeonNameFor)),
    [conflicts, assigned, locale, dungeonNameFor],
  );
  const entriesByIndex = useMemo(() => {
    const m = new Map<number, SquadCardEntry>();
    for (const e of entries) m.set(e.info.index, e);
    return m;
  }, [entries]);

  const onAssign = useCallback((squadIndex: number) => {
    setAssigned((cur) => {
      if (cur.includes(squadIndex)) return cur;
      const slot = cur.findIndex((x) => x == null);
      if (slot < 0) return cur;
      const next = cur.slice();
      next[slot] = squadIndex;
      return next;
    });
  }, []);
  const onUnassignSquad = useCallback((squadIndex: number) => {
    setAssigned((cur) => cur.map((x) => (x === squadIndex ? null : x)));
  }, []);
  const onUnassignSlot = useCallback((slot: number) => {
    setAssigned((cur) => cur.map((x, i) => (i === slot ? null : x)));
  }, []);

  const assignedCount = assigned.filter((x) => x != null).length;
  const isAdmin = !!me && Array.isArray(me.roles) && me.roles.includes('item_admin');

  // REQ-0337: the ONE button now has two destinations, chosen by how many of the
  // four seats the player filled themselves -- no toggle, no second screen.
  //
  //   4 squads -> SOLO, exactly as before: POST /api/schedule/sorties creates a
  //     visibility:'self' room, fills all four slots atomically and MARCHES.
  //   1-3 squads -> the empty seats ARE the recruitment: POST /api/schedule/troops
  //     opens a visibility:'public' Troop with the first squad seated in slot 0,
  //     then one POST .../join per REMAINING squad of the player's own. The Troop
  //     does NOT depart here -- it sits recruiting until other players (human, or
  //     the reactive fleet) take the free seats; filling the fourth auto-departs it
  //     server-side (REQ-0325). So this is 'recruit', never 'launch'.
  //   0 squads -> nothing to do (the bar stays un-ready).
  //
  // The host CAN seat several of their own squads because the deploy gate only
  // rejects the SAME squad twice in one room ('same_room_duplicate'); two
  // DIFFERENT squads with no shared uids are legal seats for one owner.
  const onLaunch = useCallback(async () => {
    if (assignedCount < 1 || launching) return;
    const squadIndices = assigned.filter((x): x is number => x != null);
    setLaunching(true);
    setLaunchError(null);
    try {
      // REQ-0304: NO dungeonId on either path -- the player sets ONLY attackLv
      // (= level); the server RANDOM-DRAWS the dungeon from those whose
      // levelMin <= attackLv and returns it on the room/troop, which
      // SchedulePage reveals post-entry.
      let watchRoomId: string;
      if (squadIndices.length === 4) {
        const { room } = await createSortie({
          level,
          formationId: formationId || undefined,
          cancelPolicy: { immediate: advanced.cancelImmediate },
          genSeed: isAdmin && advanced.genSeed ? advanced.genSeed : undefined,
          squadIndices,
        });
        watchRoomId = room.id;
      } else {
        const { troop } = await hostTroop({
          level,
          formationId: formationId || undefined,
          cancelPolicy: { immediate: advanced.cancelImmediate },
          genSeed: isAdmin && advanced.genSeed ? advanced.genSeed : undefined,
          squadIndex: squadIndices[0],
        });
        watchRoomId = troop.id;
        // Seat the player's REMAINING squads one at a time. If one is refused the
        // Troop is still a perfectly valid recruitment (just with more seats open
        // than intended), so we do NOT roll it back -- we report which squad was
        // refused and stay on this page rather than navigating away from the
        // error. The Troop is already visible on the Expeditions screen.
        for (let i = 1; i < squadIndices.length; i++) {
          try {
            await joinTroop(troop.id, squadIndices[i]);
          } catch (e) {
            setLaunchError(t(locale, 'sortie.recruit.seatFailed', { n: i + 1 }) + friendlyScheduleError(locale, e));
            return;
          }
        }
      }
      // Hand the new room/troop off to SchedulePage (read once on its mount): it
      // opens the monitor for it, revealing the DRAWN dungeon (name + theme +
      // banner) and -- for a Troop -- its live seat fill.
      // REQ-0371: remember the attackLv this commit used. A client-only field
      // riding the persisted canvas (sortiePrefs.ts); notifyStateChanged()
      // routes it through the ONE auto-save writer like any canvas mutation.
      writeSortieAttackLv(storeSnapshot.state, level);
      notifyStateChanged();
      try { sessionStorage.setItem('bp.watchRoom', watchRoomId); } catch { /* private mode */ }
      setRoute('schedule');
    } catch (e) {
      const failedKey = squadIndices.length === 4 ? 'sortie.launch.failed' : 'sortie.recruit.failed';
      setLaunchError(t(locale, failedKey) + friendlyScheduleError(locale, e));
    } finally {
      setLaunching(false);
    }
  }, [assignedCount, launching, assigned, level, formationId, advanced, isAdmin, locale]);

  // REQ-0304: pressing ENTER on the attackLv input commits the sortie (triggers the
  // draw + entry) once the troop is mustered -- the ratified "set attackLv and
  // press ENTER" gesture. REQ-0337 relaxes the threshold from exactly-4 to at
  // least-1, matching onLaunch: 4 marches solo, 1-3 opens a public recruitment.
  const onAttackLvEnter = useCallback(() => {
    if (assignedCount >= 1 && !launching) void onLaunch();
  }, [assignedCount, launching, onLaunch]);

  return (
    <div className="sortie-page" data-testid="sortie-page">
      <div className="expedition-bgart" aria-hidden="true" />

      <section className="sortie-pagehead">
        <a className="sortie-back" href="#/schedule" data-testid="sortie-back">‹ {t(locale, 'sortie.back')}</a>
        <div className="sortie-pagehead-main">
          <div className="sortie-pagehead-kicker den">{t(locale, 'sortie.pageKicker')}</div>
          <h1 className="sortie-pagehead-title dj dj-wide">{t(locale, 'sortie.pageTitle')}</h1>
          <div className="sortie-pagehead-lede">{t(locale, 'sortie.pageLede')}</div>
        </div>
      </section>

      <section className="sortie-zone sortie-zone-dest">
        <div className="sortie-zone-head">
          <span className="den">{t(locale, 'sortie.entry.den')}</span>
          <span className="rune-divider" aria-hidden="true">ᚠ</span>
        </div>
        {loadError ? <div className="schedule-error sortie-notice" data-testid="sortie-load-error">{loadError}</div> : null}
        <section className="sortie-entry panel" data-testid="sortie-entry">
          <p className="sortie-entry-note">{t(locale, 'sortie.entry.note')}</p>
          <div className="sortie-dossier-controls">
            <LevelStepper locale={locale} level={level} onChange={setLevel} onEnter={onAttackLvEnter} />
            <label className="sortie-formation">
              <span className="den">{t(locale, 'sortie.formation.label')}</span>
              <select
                className="sortie-formation-select"
                data-testid="sortie-formation-select"
                value={formationId}
                onChange={(e) => setFormationId(e.target.value)}
              >
                {(dungeons ? dungeons.formations : []).map((f) => <option key={f.id} value={f.id}>{localizedName(locale, f)}</option>)}
              </select>
            </label>
          </div>
          <AdvancedFold locale={locale} isAdmin={isAdmin} value={advanced} onChange={setAdvanced} />
        </section>
      </section>

      <section className="sortie-zone sortie-zone-muster">
        <div className="sortie-zone-head">
          <span className="den">{t(locale, 'sortie.muster.den')}</span>
          <span className="rune-divider" aria-hidden="true">ᛘ</span>
        </div>
        <div className="sortie-muster-grid">
          <div className="sortie-muster-troop">
            <TroopSlots locale={locale} assigned={assigned} entriesByIndex={entriesByIndex} onUnassign={onUnassignSlot} />
          </div>
          <div className="sortie-muster-shelf">
            <div className="sortie-shelf-title den">{t(locale, 'sortie.shelf.title')}</div>
            <SquadShelf locale={locale} entries={entries} onAssign={onAssign} onUnassign={onUnassignSquad} />
          </div>
        </div>
      </section>

      <LaunchBar
        locale={locale}
        assignedCount={assignedCount}
        launching={launching}
        error={launchError}
        onLaunch={onLaunch}
      />
    </div>
  );
}
