// client/src/sortie/SortiePage.tsx -- REQ-0239 (design 01): the dedicated
// #/sortie route. Two visual phases on ONE page: Destination (gallery +
// dossier) and Muster (troop slots + squad shelf), with a sticky launch bar.
// Owns the fetches (dungeons / rooms / me), the selection state, and the
// atomic launch (POST /api/schedule/sorties, REQ-0239 D1).
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createSortie,
  fetchDungeons,
  fetchMe,
  fetchRooms,
  type ApiDungeonsPayload,
  type ApiMe,
  type ApiRoom,
} from '../api';
import { friendlyScheduleError } from '../schedule/errors';
import { t } from '../i18n';
import { localizedName } from '../lib/contentName';
import { clearSortieFocusDungeonId, setRoute, type Locale } from '../store';
import { LaunchBar } from './LaunchBar';
import { SquadShelf } from './SquadShelf';
import { TroopSlots } from './TroopSlots';
import { LevelStepper } from './LevelStepper';
import { deriveSquadCard, type SquadCardEntry } from './deriveSquadCard';
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

  const [level, setLevel] = useState(1);
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

  const onLaunch = useCallback(async () => {
    if (assignedCount !== 4 || launching) return;
    const squadIndices = assigned.filter((x): x is number => x != null);
    setLaunching(true);
    setLaunchError(null);
    try {
      // REQ-0304: NO dungeonId -- the player sets ONLY attackLv (= level); the
      // server RANDOM-DRAWS the dungeon from those whose levelMin <= attackLv and
      // returns it on the room, which SchedulePage reveals post-entry.
      const { room } = await createSortie({
        level,
        formationId: formationId || undefined,
        cancelPolicy: { immediate: advanced.cancelImmediate },
        genSeed: isAdmin && advanced.genSeed ? advanced.genSeed : undefined,
        squadIndices,
      });
      // Hand the new room off to SchedulePage (read once on its mount): it opens the
      // monitor for this room, revealing the DRAWN dungeon (name + theme + banner).
      try { sessionStorage.setItem('bp.watchRoom', room.id); } catch { /* private mode */ }
      setRoute('schedule');
    } catch (e) {
      setLaunchError(t(locale, 'sortie.launch.failed') + friendlyScheduleError(locale, e));
    } finally {
      setLaunching(false);
    }
  }, [assignedCount, launching, assigned, level, formationId, advanced, isAdmin, locale]);

  // REQ-0304: pressing ENTER on the attackLv input commits the sortie (triggers the
  // draw + entry) once the troop is fully mustered -- the ratified "set attackLv and
  // press ENTER" gesture.
  const onAttackLvEnter = useCallback(() => {
    if (assignedCount === 4 && !launching) void onLaunch();
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
