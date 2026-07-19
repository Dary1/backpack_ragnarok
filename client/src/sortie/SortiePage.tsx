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
  type ApiDungeonsPayload,
  type ApiMe,
  type ApiRoom,
} from '../api';
import { friendlyScheduleError } from '../schedule/errors';
import { t } from '../i18n';
import { localizedName } from '../lib/contentName';
import { clearSortieFocusDungeonId, setRoute, type Locale } from '../store';
import { DungeonGallery } from './DungeonGallery';
import { DungeonDossier } from './DungeonDossier';
import { LaunchBar } from './LaunchBar';
import { SquadShelf } from './SquadShelf';
import { TroopSlots } from './TroopSlots';
import { deriveSquadCard, type SquadCardEntry } from './deriveSquadCard';
import { type SortieAdvanced } from './AdvancedFold';
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
  const [dungeonUnknown, setDungeonUnknown] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [level, setLevel] = useState(1);
  const [formationId, setFormationId] = useState('');
  const [assigned, setAssigned] = useState<(number | null)[]>(EMPTY_TROOP);
  const [advanced, setAdvanced] = useState<SortieAdvanced>({ cancelImmediate: false, genSeed: '' });

  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const musterRef = useRef<HTMLDivElement | null>(null);
  const scrolledForRef = useRef<string | null>(null);

  const loadDungeons = useCallback(() => {
    setLoadError(null);
    fetchDungeons().then(setDungeons).catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    loadDungeons();
    fetchRooms().then((r) => setRooms(r.rooms)).catch(() => setRooms([]));
    fetchMe().then(setMe).catch(() => setMe(null));
  }, [loadDungeons]);

  // Deep-link (#/sortie/<id>) preselection: consume the one-shot store focus.
  useEffect(() => {
    if (!focusDungeonId || !dungeons) return;
    const found = dungeons.dungeons.find((d) => d.id === focusDungeonId);
    if (found) { setSelectedId(found.id); }
    else { setDungeonUnknown(true); }
    clearSortieFocusDungeonId();
  }, [focusDungeonId, dungeons]);

  // Default formation once dungeons load.
  useEffect(() => {
    if (dungeons && !formationId && dungeons.formations.length > 0) setFormationId(dungeons.formations[0].id);
  }, [dungeons, formationId]);

  const selectedDungeon = useMemo(
    () => (selectedId && dungeons ? dungeons.dungeons.find((d) => d.id === selectedId) ?? null : null),
    [selectedId, dungeons],
  );

  const onSelectDungeon = useCallback((id: string) => {
    setSelectedId(id);
    setDungeonUnknown(false);
    const d = dungeons?.dungeons.find((x) => x.id === id);
    if (d && d.levelMin != null) setLevel(Math.max(1, d.levelMin));
  }, [dungeons]);

  // Auto-scroll Phase B into view ONCE per dungeon selection (design 01 sec 7).
  useEffect(() => {
    if (!selectedId) return;
    if (scrolledForRef.current === selectedId) return;
    scrolledForRef.current = selectedId;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    musterRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, [selectedId]);

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
    if (!selectedDungeon || assignedCount !== 4) return;
    const squadIndices = assigned.filter((x): x is number => x != null);
    setLaunching(true);
    setLaunchError(null);
    try {
      const { room } = await createSortie({
        dungeonId: selectedDungeon.id,
        level,
        formationId: formationId || undefined,
        cancelPolicy: { immediate: advanced.cancelImmediate },
        genSeed: isAdmin && advanced.genSeed ? advanced.genSeed : undefined,
        squadIndices,
      });
      // Hand the new room off to SchedulePage (read once on its mount).
      try { sessionStorage.setItem('bp.watchRoom', room.id); } catch { /* private mode */ }
      setRoute('schedule');
    } catch (e) {
      setLaunchError(t(locale, 'sortie.launch.failed') + friendlyScheduleError(locale, e));
    } finally {
      setLaunching(false);
    }
  }, [selectedDungeon, assignedCount, assigned, level, formationId, advanced, isAdmin, locale]);

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
          <span className="den">{t(locale, 'sortie.dest.den')}</span>
          <span className="rune-divider" aria-hidden="true">ᚠ</span>
        </div>
        {dungeonUnknown ? <div className="schedule-error sortie-notice">{t(locale, 'sortie.dungeonUnknown')}</div> : null}
        <DungeonGallery
          locale={locale}
          dungeons={dungeons ? dungeons.dungeons : null}
          loadError={loadError}
          selectedId={selectedId}
          onSelect={onSelectDungeon}
          onRetry={loadDungeons}
        />
        {selectedDungeon && dungeons ? (
          <DungeonDossier
            locale={locale}
            dungeon={selectedDungeon}
            formations={dungeons.formations}
            level={level}
            onLevelChange={setLevel}
            formationId={formationId}
            onFormationChange={setFormationId}
            advanced={advanced}
            onAdvancedChange={setAdvanced}
            isAdmin={isAdmin}
          />
        ) : null}
      </section>

      <section className="sortie-zone sortie-zone-muster" ref={musterRef}>
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
        dungeonSelected={!!selectedDungeon}
        assignedCount={assignedCount}
        launching={launching}
        error={launchError}
        onLaunch={onLaunch}
      />
    </div>
  );
}
