// client/src/ragnarok/DevotionSection.tsx -- REQ-0066. The Devotion rite
// from web/redesign/ragnarok.html, in the FROZEN 3-step flow (do not
// redesign): (1) pick a squad, (2) read the vow / blast-radius manifest,
// (3) the final-question modal -> engrave.
//
// Candidate picker: every squad is listed; an INELIGIBLE squad is shown
// LOCKED (dimmed, not hidden) with its reason spelled out -- REQ-0067
// item 4, mirroring the market's "locked, not hidden" language. Reasons
// come from the server preview (eligible:false + reasons[]), vocab
// mid_rite / last_squad / empty_squad / deployed.
//
// The blast-radius MANIFEST (REQ-0067 item 1: "the manifest carries the
// weight, not the last question") itemizes the FULL account-wide
// destruction BEFORE the final vow: counts of BPs/POs/SIs destroyed +
// which OTHER squads also lose shared pieces. This is the confirmation
// UI the spec requires.
//
// THE RACE GUARD lives in the page (refreshAfterServerMutation, passed as
// onDevoted): after a successful POST the page re-GETs the fresh canvas
// into the store BEFORE this component reveals the "engraved" state, so a
// stale auto-save can't resurrect the destroyed items. confirm() awaits
// onDevoted() BEFORE flipping to the 'done' phase -- byte-for-byte the
// market BuyModal's confirm->onSettled->reveal ordering.
import { useEffect, useState } from 'react';
import type { Locale } from '../store';
import { t } from '../i18n';
import {
  ApiError, devoteRagnarok,
  type ApiRagnarokDevotionPreviewResponse, type ApiRagnarokBlast,
} from '../api';
import { Valknut } from './ragnarokShared';

/** A squad as the picker sees it: index + display name (from the live
 * store's state.presets.names). Eligibility/blast are resolved lazily
 * from the server preview when the candidate is selected. */
export interface SquadCandidate {
  index: number;
  name: string;
}

type RiteReason = 'mid_rite' | 'last_squad' | 'empty_squad' | 'deployed';

function reasonLabel(locale: Locale, reason: RiteReason): string {
  return t(locale, `ragnarok.reason.${reason}` as never);
}

type RiteErrKey =
  | 'ragnarok.err.deployed' | 'ragnarok.err.empty_squad' | 'ragnarok.err.mid_rite'
  | 'ragnarok.err.last_squad' | 'ragnarok.err.notFound' | 'ragnarok.err.generic';

function errorKeyForReason(reason: string | undefined): RiteErrKey {
  switch (reason) {
    case 'deployed': return 'ragnarok.err.deployed';
    case 'empty_squad': return 'ragnarok.err.empty_squad';
    case 'mid_rite': return 'ragnarok.err.mid_rite';
    case 'last_squad': return 'ragnarok.err.last_squad';
    default: return 'ragnarok.err.generic';
  }
}

/** The blast-radius manifest panel -- the itemized, account-wide
 * destruction (BP/PO/SI counts + affected OTHER squads). Rendered from
 * the server preview's `blast`. */
function BlastManifest({ locale, blast }: { locale: Locale; blast: ApiRagnarokBlast }) {
  return (
    <div className="ragnarok-blast" data-testid="ragnarok-blast-manifest" data-total={blast.total}>
      <div className="row" style={{ gap: 12 }}>
        <h4 className="dj" style={{ margin: 0, fontSize: 15, fontWeight: 800, letterSpacing: '.16em' }}>{t(locale, 'ragnarok.blast.title')}</h4>
        <span className="en">{t(locale, 'ragnarok.blast.titleEn')}</span>
      </div>
      <p className="ragnarok-blast-lede">{t(locale, 'ragnarok.blast.lede')}</p>
      <div className="ragnarok-blast-counts">
        <div className="ragnarok-blast-cell" data-testid="ragnarok-blast-bps"><div className="ragnarok-blast-n">{blast.bps}</div><div className="ragnarok-blast-k">{t(locale, 'ragnarok.blast.bps')}</div></div>
        <div className="ragnarok-blast-cell" data-testid="ragnarok-blast-pos"><div className="ragnarok-blast-n">{blast.pos}</div><div className="ragnarok-blast-k">{t(locale, 'ragnarok.blast.pos')}</div></div>
        <div className="ragnarok-blast-cell" data-testid="ragnarok-blast-sis"><div className="ragnarok-blast-n">{blast.sis}</div><div className="ragnarok-blast-k">{t(locale, 'ragnarok.blast.sis')}</div></div>
        <div className="ragnarok-blast-cell total" data-testid="ragnarok-blast-total"><div className="ragnarok-blast-n">{blast.total}</div><div className="ragnarok-blast-k">{t(locale, 'ragnarok.blast.total')}</div></div>
      </div>
      <div className="ragnarok-affected-title">{t(locale, 'ragnarok.blast.affectedTitle')}</div>
      {blast.affectedSquads.length > 0 ? (
        <ul className="ragnarok-affected-list" data-testid="ragnarok-blast-affected">
          {blast.affectedSquads.map((ap) => {
            const parts: string[] = [];
            if (ap.lostBps) parts.push(`${ap.lostBps} ${t(locale, 'ragnarok.blast.bpsShort')}`);
            if (ap.lostPos) parts.push(`${ap.lostPos} ${t(locale, 'ragnarok.blast.posShort')}`);
            if (ap.lostSis) parts.push(`${ap.lostSis} ${t(locale, 'ragnarok.blast.sisShort')}`);
            return (
              <li key={ap.index} data-testid="ragnarok-blast-affected-row" data-squad-index={ap.index}>
                {t(locale, 'ragnarok.blast.affectedRow', { name: ap.name, parts: parts.join(' ・ ') })}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="ragnarok-affected-none" data-testid="ragnarok-blast-affected-none">{t(locale, 'ragnarok.blast.affectedNone')}</div>
      )}
    </div>
  );
}

interface DevotionSectionProps {
  locale: Locale;
  /** Every squad from the live store (state.presets.names). */
  candidates: SquadCandidate[];
  /** Lifted so the page can drive the me-row projection from the same
   * preview the manifest uses (single fetch, single source of truth). */
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  preview: ApiRagnarokDevotionPreviewResponse | null;
  previewLoading: boolean;
  previewError: string | null;
  /** THE race guard. Awaited after a successful rite BEFORE 'done' is
   * revealed: re-GETs the fresh canvas into the store, then refreshes the
   * order + hall. Provided by RagnarokPage.refreshAfterServerMutation. */
  onDevoted: () => Promise<void>;
}

type RitePhase = 'idle' | 'final' | 'done';

export function DevotionSection(props: DevotionSectionProps) {
  const { locale, candidates, selectedIndex, onSelect, preview, previewLoading, previewError, onDevoted } = props;
  const [phase, setPhase] = useState<RitePhase>('idle');
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [doneName, setDoneName] = useState<string>('');
  // A stable idempotency key per opened final-question modal, so a
  // double-submit (or a network retry) replays rather than double-rites.
  const [idemKey, setIdemKey] = useState<string>('');

  // Reset the rite phase whenever the selection changes (a new candidate
  // starts fresh at 'idle').
  useEffect(() => { setPhase('idle'); setErrMsg(null); }, [selectedIndex]);

  const selected = selectedIndex != null ? candidates.find((c) => c.index === selectedIndex) ?? null : null;
  const eligible = preview?.eligible === true;

  function openFinal() {
    if (!eligible) return;
    setErrMsg(null);
    setIdemKey(`rite-${preview?.squad.index}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setPhase('final');
  }

  async function confirm() {
    if (selectedIndex == null) return;
    setBusy(true);
    setErrMsg(null);
    try {
      const res = await devoteRagnarok(selectedIndex, idemKey);
      setDoneName(res.einherjar.squadName);
      // CRITICAL: re-GET the fresh (rewritten) canvas into the store
      // BEFORE revealing 'done', so a pending auto-save cannot PUT the
      // stale pre-rite canvas and resurrect the destroyed items. Awaited.
      await onDevoted();
      setPhase('done');
    } catch (e) {
      const reason = e instanceof ApiError ? e.reason : undefined;
      const status = e instanceof ApiError ? e.status : undefined;
      // 404 = the squad is gone (already devoted / shifted). Everything
      // else with a 409 reason maps to its own message.
      setErrMsg(t(locale, status === 404 ? 'ragnarok.err.notFound' : errorKeyForReason(reason)));
      // The server state may have advanced (e.g. mid_rite from a
      // concurrent tab, or the slot vanished) -- refresh so the picker and
      // order reflect reality. Fire-and-forget; the modal error is shown.
      void onDevoted();
    } finally {
      setBusy(false);
    }
  }

  function closeDone() {
    setPhase('idle');
    onSelect(null);
  }

  const hasSquads = candidates.length > 0;

  return (
    <section data-testid="ragnarok-devotion">
      <div className="row" style={{ gap: 14, marginBottom: 12 }}>
        <h2 className="dj" style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '.24em' }}>{t(locale, 'ragnarok.devotion.title')}</h2>
        <span className="en">{t(locale, 'ragnarok.devotion.titleEn')}</span>
      </div>

      <div className="ragnarok-dev-grid">
        {/* LEFT: candidate picker + selected candidate card */}
        <div className="ragnarok-pick">
          <div className="ragnarok-pick-title">{t(locale, 'ragnarok.devotion.pickTitle')}</div>
          <div className="ragnarok-pick-hint">{t(locale, 'ragnarok.devotion.pickHint')}</div>

          {!hasSquads ? (
            <div className="ragnarok-cand-reason" data-testid="ragnarok-devotion-no-squads">{t(locale, 'ragnarok.devotion.noSquads')}</div>
          ) : (
            <div className="ragnarok-cand-list" data-testid="ragnarok-candidate-list">
              {candidates.map((c) => {
                const isSel = c.index === selectedIndex;
                // Eligibility/reasons are known only for the SELECTED
                // candidate (that is the one we have a preview for). Others
                // render neutrally until selected -- selecting one fetches
                // its preview, which then reveals locked+reason if any.
                const showReasons = isSel && preview && !preview.eligible;
                const lockedCls = showReasons ? ' is-locked' : '';
                return (
                  <button
                    key={c.index}
                    type="button"
                    className={`ragnarok-cand${isSel ? ' is-on' : ''}${lockedCls}`}
                    data-testid={`ragnarok-devotion-candidate-${c.index}`}
                    data-squad-index={c.index}
                    data-selected={isSel ? 'true' : 'false'}
                    data-eligible={isSel && preview ? (preview.eligible ? 'true' : 'false') : ''}
                    onClick={() => onSelect(isSel ? null : c.index)}
                  >
                    <span className="ragnarok-cand-nm">{c.name}</span>
                    {showReasons ? (
                      <>
                        <span className="ragnarok-cand-lock" data-testid={`ragnarok-candidate-lock-${c.index}`}>{t(locale, 'ragnarok.devotion.locked')}</span>
                        <span className="ragnarok-cand-reason" data-testid={`ragnarok-candidate-reason-${c.index}`}>
                          {preview!.reasons.map((r) => reasonLabel(locale, r as RiteReason)).join(' ・ ')}
                        </span>
                      </>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}

          {/* Selected candidate card (the mock's .ucard) -- shows the
              devoted squad's identity + valknut + serving line. */}
          {selected ? (
            <div className="ragnarok-ucard rar rar-mythic" data-testid="ragnarok-candidate-card" style={{ marginTop: 6 }}>
              <div className="ragnarok-vkbox">
                <Valknut size={34} className="ragnarok-valknut" />
                <div className="ragnarok-vk-c">{t(locale, 'ragnarok.devotion.valknut')}</div>
              </div>
              <div className="ragnarok-u-head">
                <div>
                  <div className="ragnarok-u-name">{selected.name}</div>
                  <div className="rar-word" style={{ marginTop: 2 }}>{t(locale, 'ragnarok.devotion.candidateWord')}</div>
                </div>
              </div>
              {preview ? (
                <div className="ragnarok-u-foot" data-testid="ragnarok-candidate-serves">
                  {t(locale, 'ragnarok.blast.serves', { when: '—', bps: preview.blast.bps, pos: preview.blast.pos, sis: preview.blast.sis })}
                </div>
              ) : null}
            </div>
          ) : null}

          <p className="ragnarok-dev-warn">{t(locale, 'ragnarok.devotion.warn')}</p>
        </div>

        {/* RIGHT: the rite panel (steps + vow) OR the blast manifest. */}
        <div className="panel ornate panel-pad" data-testid="ragnarok-rite-panel">
          <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
          <div className="row" style={{ gap: 12 }}>
            <h3 className="dj" style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: '.22em' }}>{t(locale, 'ragnarok.devotion.riteTitle')}</h3>
            <span className="en">{t(locale, 'ragnarok.devotion.riteTitleEn')}</span>
          </div>

          <ol className="ragnarok-steps">
            <li><span className="no">①</span><div><b>{t(locale, 'ragnarok.devotion.step1')}</b><span className="d">{t(locale, 'ragnarok.devotion.step1d')}</span></div></li>
            <li><span className="no">②</span><div><b>{t(locale, 'ragnarok.devotion.step2')}</b><span className="d">{t(locale, 'ragnarok.devotion.step2d')}</span></div></li>
            <li><span className="no">③</span><div><b>{t(locale, 'ragnarok.devotion.step3')}</b><span className="d">{t(locale, 'ragnarok.devotion.step3d')}</span></div></li>
          </ol>

          {/* No selection yet -> prompt / empty-state. If there ARE no
              eligible squads at all, that is surfaced once the player has
              tried a candidate (locked+reason on it) -- but we also show a
              standing hint here. */}
          {selectedIndex == null ? (
            <div className="ragnarok-pick-hint" data-testid="ragnarok-devotion-select-prompt">
              {hasSquads ? t(locale, 'ragnarok.devotion.selectPrompt') : t(locale, 'ragnarok.devotion.noEligibleWhy')}
            </div>
          ) : previewLoading ? (
            <div className="ragnarok-pick-hint" data-testid="ragnarok-preview-loading">{t(locale, 'ragnarok.loading')}</div>
          ) : previewError ? (
            <div className="ragnarok-cand-reason" data-testid="ragnarok-preview-error">{previewError}</div>
          ) : preview && !preview.eligible ? (
            // Ineligible: show WHY (the reasons), no vow button. Locked,
            // not hidden.
            <div data-testid="ragnarok-devotion-ineligible" data-reasons={preview.reasons.join(',')}>
              <p className="ragnarok-dev-warn" style={{ color: 'var(--blood)' }}>
                {preview.reasons.map((r) => reasonLabel(locale, r as RiteReason)).join(' ・ ')}
              </p>
              <div className="ragnarok-pick-hint">{t(locale, 'ragnarok.devotion.noEligibleWhy')}</div>
            </div>
          ) : preview && preview.eligible ? (
            // Eligible: THE MANIFEST (carries the weight) + the vow button.
            <>
              <BlastManifest locale={locale} blast={preview.blast} />
              <div className="ragnarok-vow-row" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="btn btn-forge btn-blood"
                  data-testid="ragnarok-vow-btn"
                  onClick={openFinal}
                >
                  {t(locale, 'ragnarok.devotion.vowButton')}
                </button>
                <span className="ragnarok-vow-note">
                  {preview.projection.topPercentile != null
                    ? t(locale, 'ragnarok.devotion.projectionLine', { pct: `${t(locale, 'ragnarok.order.forecast')}: top ${preview.projection.topPercentile}%` })
                    : null}
                  <br />
                  {t(locale, 'ragnarok.devotion.projectionNote')}
                </span>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* THE FINAL-QUESTION MODAL (step 3). Reuses the mock's scrim/modal
          chrome. The manifest recap is carried here too, but the WEIGHT
          was already the manifest above (REQ-0067 item 1). */}
      {phase === 'final' && preview ? (
        <div
          className="scrim"
          data-testid="ragnarok-final-question-modal"
          onClick={(e) => { if (e.target === e.currentTarget && !busy) setPhase('idle'); }}
        >
          <div className="modal panel ornate center ragnarok-final-modal" role="dialog" aria-modal="true">
            <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
            <Valknut size={40} className="ragnarok-final-vk" />
            <div className="ragnarok-final-t">{t(locale, 'ragnarok.final.title')}</div>
            <div className="ragnarok-final-en">{t(locale, 'ragnarok.final.titleEn')}</div>
            <p className="ragnarok-final-body">{t(locale, 'ragnarok.final.body', { name: preview.squad.name })}</p>
            <div className="ragnarok-final-manifest" data-testid="ragnarok-final-manifest-recap">
              {t(locale, 'ragnarok.final.manifestRecap', {
                bps: preview.blast.bps,
                pos: preview.blast.pos,
                sis: preview.blast.sis,
                total: preview.blast.total,
                affected: preview.blast.affectedSquads.length > 0
                  ? t(locale, 'ragnarok.final.manifestAffected', { n: preview.blast.affectedSquads.length })
                  : '',
              })}
            </div>
            {errMsg ? <div className="ragnarok-final-err" data-testid="ragnarok-final-error">{errMsg}</div> : null}
            <div className="ragnarok-final-actions">
              <button type="button" className="btn btn-blood" data-testid="ragnarok-final-yes" disabled={busy} onClick={() => void confirm()}>
                {busy ? t(locale, 'ragnarok.final.working') : t(locale, 'ragnarok.final.yes')}
              </button>
              <button type="button" className="btn btn-ghost" data-testid="ragnarok-final-no" disabled={busy} onClick={() => setPhase('idle')}>
                {t(locale, 'ragnarok.final.no')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* THE ENGRAVED SUCCESS STATE (only revealed AFTER the race guard
          re-GET completed). */}
      {phase === 'done' ? (
        <div className="scrim" data-testid="ragnarok-engraved-modal" onClick={(e) => { if (e.target === e.currentTarget) closeDone(); }}>
          <div className="modal panel ornate center ragnarok-final-modal" role="dialog" aria-modal="true">
            <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
            <Valknut size={40} className="ragnarok-final-vk" />
            <div className="rune-divider">ᛗ</div>
            <div className="ragnarok-done-title" data-testid="ragnarok-engraved-title">{t(locale, 'ragnarok.done.title')}</div>
            <p className="ragnarok-done-body">{t(locale, 'ragnarok.done.body', { name: doneName })}</p>
            <div className="ragnarok-final-actions">
              <button type="button" className="btn" data-testid="ragnarok-engraved-close" onClick={closeDone}>{t(locale, 'ragnarok.done.close')}</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
