// client/src/schedule/SealPanel.tsx -- REQ-0058: Sealed Seed Share UI.
// Rendered in the Schedule page's spoils column. Three parts:
//   1. Seal a schedule -> POST /api/schedule/seal (server mints a fresh,
//      never-run seed; REQ-0043's admin-only custom-seed gate is untouched),
//      then shows the share token to copy.
//   2. Join a sealed run -> POST /api/schedule/rooms {sealId} (the room
//      copies the frozen tuple verbatim; one run per participant).
//   3. Comparison -> GET /api/schedule/seals/:sealId/comparison, the
//      anti-spoiler-gated side-by-side timelines. OTHER participants stay
//      hidden until the caller's OWN run of this seal settles; then the
//      table reveals every runner with clear time / finishing H / damage
//      taken / attachments resolved + a per-encounter timeline, and a
//      "Replay" link into each run (own -> live monitor; others ->
//      GET .../runs/:playerId, gated the same anti-spoiler way).
import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  fetchSealComparison,
  fetchSealReplay,
  joinSealRoom,
  sealSchedule,
  type ApiDungeonsPayload,
  type ApiSealComparison,
  type ApiSealParticipant,
  type ApiSealReplay,
} from '../api';
import { t } from '../i18n';
import type { Locale } from '../store';
import { localizedName } from './CreateRoomForm';

interface SealPanelProps {
  locale: Locale;
  dungeons: ApiDungeonsPayload | null;
  onOpenRoom: (roomId: string) => void;
  onRoomsChanged: () => void;
}

const COMPARE_POLL_MS = 5000;

function resultLabel(locale: Locale, result: string): string {
  if (result === 'victory') return t(locale, 'seal.resultVictory');
  if (result === 'wipe') return t(locale, 'seal.resultWipe');
  return t(locale, 'seal.resultIncomplete');
}

function errMsg(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : String(e);
}

export function SealPanel({ locale, dungeons, onOpenRoom, onRoomsChanged }: SealPanelProps) {
  const [dungeonId, setDungeonId] = useState('');
  const [level, setLevel] = useState(1);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [joinInput, setJoinInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinedMsg, setJoinedMsg] = useState<string | null>(null);

  const [activeSealId, setActiveSealId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ApiSealComparison | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [replays, setReplays] = useState<Record<string, ApiSealReplay>>({});

  useEffect(() => {
    if (dungeons && dungeons.dungeons.length > 0 && !dungeonId) setDungeonId(dungeons.dungeons[0].id);
  }, [dungeons, dungeonId]);

  const loadComparison = useCallback(async (sealId: string) => {
    try {
      const c = await fetchSealComparison(sealId);
      setComparison(c);
      setCompareError(null);
    } catch (e) {
      setComparison(null);
      setCompareError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    if (!activeSealId) return undefined;
    void loadComparison(activeSealId);
    const id = setInterval(() => void loadComparison(activeSealId), COMPARE_POLL_MS);
    return () => clearInterval(id);
  }, [activeSealId, loadComparison]);

  const handleMint = useCallback(async () => {
    setMinting(true);
    setMintError(null);
    setCopied(false);
    try {
      const res = await sealSchedule({ dungeonId: dungeonId || undefined, level });
      setShareToken(res.shareToken);
      setActiveSealId(res.seal.sealId);
    } catch (e) {
      setMintError(errMsg(e));
    } finally {
      setMinting(false);
    }
  }, [dungeonId, level]);

  const handleCopy = useCallback(async () => {
    if (!shareToken) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) await navigator.clipboard.writeText(shareToken);
      setCopied(true);
    } catch {
      /* clipboard unavailable -- the token is visible to copy manually */
    }
  }, [shareToken]);

  const handleJoin = useCallback(async () => {
    const token = joinInput.trim();
    if (!token) return;
    setJoining(true);
    setJoinError(null);
    setJoinedMsg(null);
    try {
      await joinSealRoom(token);
      setJoinedMsg(t(locale, 'seal.joined'));
      setActiveSealId(token);
      setJoinInput('');
      onRoomsChanged();
    } catch (e) {
      setJoinError(errMsg(e));
    } finally {
      setJoining(false);
    }
  }, [joinInput, locale, onRoomsChanged]);

  const openReplay = useCallback(async (row: ApiSealParticipant) => {
    if (row.isSelf) {
      onOpenRoom(row.roomId);
      return;
    }
    if (!activeSealId) return;
    try {
      const r = await fetchSealReplay(activeSealId, row.playerId);
      setReplays((prev) => ({ ...prev, [row.playerId]: r }));
    } catch (e) {
      setCompareError(errMsg(e));
    }
  }, [activeSealId, onOpenRoom]);

  const rows: ApiSealParticipant[] = comparison
    ? comparison.unlocked
      ? comparison.participants
      : [comparison.self]
    : [];

  return (
    <section className="panel ornate seal-panel" data-testid="seal-panel">
      <h3 className="dj">{t(locale, 'seal.sectionTitle')}</h3>
      <p className="seal-lede t-micro">{t(locale, 'seal.sectionLede')}</p>

      {/* 1. Seal a schedule */}
      <div className="seal-mint">
        <div className="seal-mint-title den">{t(locale, 'seal.mintTitle')}</div>
        <div className="seal-mint-row">
          <label className="seal-field">
            <span className="seal-field-label">{t(locale, 'schedule.dungeonLabel')}</span>
            <select
              className="seal-dungeon-select"
              value={dungeonId}
              onChange={(e) => setDungeonId(e.target.value)}
              data-testid="seal-dungeon-select"
            >
              {(dungeons?.dungeons ?? []).map((d) => (
                <option key={d.id} value={d.id}>{localizedName(locale, d)}</option>
              ))}
            </select>
          </label>
          <label className="seal-field">
            <span className="seal-field-label">{t(locale, 'seal.levelLabel')}</span>
            <input
              className="seal-level-input"
              type="number"
              min={1}
              value={level}
              onChange={(e) => setLevel(Math.max(1, parseInt(e.target.value, 10) || 1))}
              data-testid="seal-level-input"
            />
          </label>
          <button
            type="button"
            className="btn seal-mint-btn"
            onClick={() => void handleMint()}
            disabled={minting || !dungeonId}
            data-testid="seal-mint-btn"
          >
            {minting ? t(locale, 'seal.minting') : t(locale, 'seal.mintBtn')}
          </button>
        </div>
        {mintError ? <div className="schedule-error" data-testid="seal-mint-error">{t(locale, 'seal.error')}{mintError}</div> : null}
        {shareToken ? (
          <div className="seal-share" data-testid="seal-share">
            <span className="seal-share-label den">{t(locale, 'seal.shareLabel')}</span>
            <code className="seal-share-token" data-testid="seal-share-token">{shareToken}</code>
            <button type="button" className="btn seal-copy-btn" onClick={() => void handleCopy()} data-testid="seal-copy-btn">
              {copied ? t(locale, 'seal.copied') : t(locale, 'seal.copyBtn')}
            </button>
            <p className="seal-share-hint t-micro">{t(locale, 'seal.shareHint')}</p>
          </div>
        ) : null}
      </div>

      {/* 2. Join a sealed run */}
      <div className="seal-join">
        <div className="seal-join-title den">{t(locale, 'seal.joinTitle')}</div>
        <div className="seal-join-row">
          <input
            className="seal-join-input"
            value={joinInput}
            placeholder={t(locale, 'seal.joinPlaceholder')}
            onChange={(e) => setJoinInput(e.target.value)}
            data-testid="seal-join-input"
          />
          <button
            type="button"
            className="btn seal-join-btn"
            onClick={() => void handleJoin()}
            disabled={joining || joinInput.trim().length === 0}
            data-testid="seal-join-btn"
          >
            {joining ? t(locale, 'seal.joining') : t(locale, 'seal.joinBtn')}
          </button>
        </div>
        {joinError ? <div className="schedule-error" data-testid="seal-join-error">{t(locale, 'seal.error')}{joinError}</div> : null}
        {joinedMsg ? <div className="seal-joined t-micro" data-testid="seal-joined">{joinedMsg}</div> : null}
      </div>

      {/* 3. Comparison */}
      {activeSealId ? (
        <div className="seal-comparison" data-testid="seal-comparison">
          <div className="seal-comparison-head">
            <h4 className="dj">{t(locale, 'seal.compareTitle')}</h4>
            <button type="button" className="btn seal-refresh-btn" onClick={() => void loadComparison(activeSealId)} data-testid="seal-refresh-btn">
              {t(locale, 'seal.refreshBtn')}
            </button>
          </div>
          {compareError ? (
            <div className="schedule-error" data-testid="seal-compare-error">{compareError}</div>
          ) : comparison === null ? (
            <div className="seal-compare-loading t-micro">{t(locale, 'seal.compareLoading')}</div>
          ) : (
            <>
              <div className="seal-participant-count t-micro">{t(locale, 'seal.compareParticipants', { count: comparison.participantCount })}</div>
              {!comparison.unlocked ? (
                <div className="seal-locked" data-testid="seal-comparison-locked">{t(locale, 'seal.compareLocked')}</div>
              ) : null}
              <table className="seal-table" data-testid="seal-table">
                <thead>
                  <tr>
                    <th>{t(locale, 'seal.colPlayer')}</th>
                    <th>{t(locale, 'seal.colResult')}</th>
                    <th>{t(locale, 'seal.colClearTime')}</th>
                    <th>{t(locale, 'seal.colH')}</th>
                    <th>{t(locale, 'seal.colDamage')}</th>
                    <th>{t(locale, 'seal.colAttachments')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const tl = row.timeline;
                    const replay = replays[row.playerId];
                    return (
                      <tr key={row.playerId} className={row.isSelf ? 'seal-row seal-row-self' : 'seal-row'} data-testid="seal-comparison-row" data-player={row.playerId}>
                        <td className="seal-cell-player">
                          {row.isSelf ? t(locale, 'seal.you') : row.playerId}
                          {row.hasRun && !row.settled ? <span className="seal-badge t-micro"> · {t(locale, 'seal.running')}</span> : null}
                          {!row.hasRun ? <span className="seal-badge t-micro"> · {t(locale, 'seal.notStarted')}</span> : null}
                        </td>
                        <td>{tl ? resultLabel(locale, tl.result) : '—'}</td>
                        <td>{tl ? `${Math.round(tl.clearTimeSecs)}s` : '—'}</td>
                        <td>{tl && tl.finishingH != null ? tl.finishingH.toFixed(2) : '—'}</td>
                        <td>{tl ? Math.round(tl.damageTaken) : '—'}</td>
                        <td>{tl ? tl.attachmentsResolved : '—'}</td>
                        <td>
                          {row.hasRun ? (
                            <button type="button" className="btn seal-replay-btn" onClick={() => void openReplay(row)} data-testid="seal-replay-btn">
                              {t(locale, 'seal.replayLink')}
                              {replay ? <span className="t-micro"> · {t(locale, 'seal.replayEvents', { count: replay.events.length })}</span> : null}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* per-encounter timelines (the "timeline" the REQ calls for) */}
              {rows.filter((r) => r.timeline && r.timeline.encounters.length > 0).map((r) => (
                <div key={'enc-' + r.playerId} className="seal-encounters" data-testid="seal-encounters" data-player={r.playerId}>
                  <div className="seal-encounters-title t-micro den">
                    {(r.isSelf ? t(locale, 'seal.you') : r.playerId)} · {t(locale, 'seal.encountersTitle')}
                  </div>
                  <ul className="seal-encounters-list">
                    {r.timeline!.encounters.map((enc) => (
                      <li key={enc.enc} className="seal-encounter t-micro">
                        #{enc.enc} {enc.kind} · {Math.round(enc.durationSecs)}s · {Math.round(enc.endPct)}%
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
