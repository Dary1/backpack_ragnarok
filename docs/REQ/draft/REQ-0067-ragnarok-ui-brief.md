> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0067 — Hall of Ragnarök UI: design brief for round 2 (to the UI designer)

- **Status**: ISSUED to the UI designer (2026-07-06). Companion to REQ-0066.
  Deliverable = updated `web/redesign/ragnarok.html` (+ tiny asset additions).

## 日本語サマリ
殿堂mockは核心(誓約・石版・儀式の3段・最後の問い)が完成しています。凍結です。
実装REQ(0066)から逆算した「未描画の状態」と、献身の**取り返しのつかなさ**を正しく
伝えるための追加だけをお願いします。P1が実装ブロッカー。声のトーン(石・刻銘・
永劫)はそのままで。

## Frozen — do NOT redesign
Pledge hero + valknut mark; season wheel + countdown strip; stone-tablet table
aesthetic (top1-3 treatment, gap row, me-row with 汝 badge); tier chip row; the
three-step ceremony; 最後の問い modal; hall strip cards (永劫に在り); footer line
石は忘れない. All microcopy voice.

## P1 — blocking states & additions
1. **Devotion blast radius** (the big one): the vow must itemize what is lost —
   REQ-0066 §4: destroying a squad's items removes them from EVERY squad that
   shares them (reference model). Design the loss manifest: BP/PO/SI counts, and a
   「他の型にも波及」 list (which other squads lose pieces). This belongs BETWEEN
   step ② and the final modal — the last question stays short, the manifest
   carries the weight.
2. **First-season empty states**: eternal order before the player has any score
   (me-row with 0 / unranked?); hall strip with zero Einherjar (「未だ誰も昇って
   いない」register); devotion section when the player has NO eligible squad
   (all deployed / none exist) — with the reason shown.
3. **Rite-in-progress + memorial**: the sealed state while the rite runs, and the
   devoted squad's card AFTER — a memorial variant (the MYTHIC card grays to stone?
   moves to the hall?) so the moment has a visual afterlife.
4. **Ineligibility on the picker**: squads locked with reasons (遠征中 / 既に選定 /
   儀の途中) — mirrors the market's 専有の法 lock language.
5. **Tier ladder legibility**: what score reaches the next tier (a quiet
   「JARLまで あとN」 under the me-row?); VALHALLA chip semantics — decide its
   visual state and meaning with the owner (currently faded, unexplained).
6. **Ranking navigation at 12k rows**: find-by-name affordance + jump-to-me;
   pagination or windowing treatment on the stone (how does a tablet scroll?).
7. **Event-time variant**: during the season-end window the season strip becomes
   the LIVE doorway (交戦中 chip, link to Act II) — one state where the countdown
   has hit zero.
8. **Projection honesty**: 「+2% (予測)」 needs its 予測 label and a one-line
   tooltip register — never promise, always forecast.
9. **EN copy pass** (house i18n: EN base + ja) — pledge included; and one
   narrow-viewport reference layout.

## P2 — quality of life
10. Emblem variety: all rows share emblem_horn3 — propose the emblem axis (per
    player? per tier? earned?) or explicitly a single-sigil world; owner decides
    from your proposal.
11. Dawn-refresh notice (「更新は毎暁」) — a quiet last-updated mark.
12. Long-name & long-number behavior in the table (CJK + tnum).
13. Reduced-motion pass: ash/snow particles and countUp respect fx-off; the
    requiem-grade moments (vow success) still land without motion.

## Constraints
- No urgency styling on the countdown (retention philosophy: inform, never
  pressure) — Ragnarok is one appointment per SEASON, by design; let it be calm.
- The vow is the one place where friction is a FEATURE — slow the player down
  there, nowhere else.
- styleguide.html tokens; assets to `redesign/assets/` (ic_*/emblem_* naming).

## Acceptance
Round-2 mock renders every P1 state; EN strings delivered alongside ja; owner
pass → REQ-0066 implementation treats round 2 as normative.
