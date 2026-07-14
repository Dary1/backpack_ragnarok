// backpack_ragnarok -- server/services/ragnarok/lib.cjs
// REQ-0145a (sd): shared ragnarok plumbing extracted verbatim from the
// pre-split services/ragnarok.cjs (origin lines 59-122, 254-257, 729-731
// @ commit 7105d23): content paths, the [TUNABLE] block, playerNameOf,
// deepCopy. Consumers outside services/ragnarok/ must keep requiring the
// services/ragnarok.cjs facade (design rule 3), never this file.
'use strict';
const players = require('../../players.cjs');

// REQ-0145a (sc): resolved via the ONE content-file loader
// (lib/content_files.cjs; CONTENT_ROOT env override honored, default
// byte-equivalent to the old os.homedir() anchoring). Captured at module
// load; tests remap homedir / inject CONTENT_ROOT + evict the module
// tree, so this rebinds exactly like before.
const { contentPath } = require('../../lib/content_files.cjs');
const SEASONS_PATH = contentPath('live', 'seasons.json');
const SIS_PATH = contentPath('live', 'live_sis.json');

// ---------------------------------------------------------------------
// Tunables ([TUNABLE] -- ragnarok-policy level, same posture as
// services/core.cjs's and services/market.cjs's tunables blocks).
// ---------------------------------------------------------------------
const RAGNAROK_DTO_VERSION = 1; // wire-shape version stamped on every /api/ragnarok response (shared/dto.ts ApiRagnarok*)
const DAY_MS = 24 * 60 * 60 * 1000;

// The dawn boundary for the Eternal Order's lazy daily rebuild (mock:
// 「更新は毎暁」"updated every dawn"). [TUNABLE][ORCH default]: 20:00 UTC
// = 05:00 JST -- the game's copy deck is Japanese, so "dawn" is read in
// JST. Purely a cache-invalidation boundary; nothing gameplay-visible
// depends on the exact hour.
const RAGNAROK_DAWN_UTC_HOUR = 20;

// 戦果 (battle score) fold weights. [TUNABLE][ORCH default, PLACEHOLDER
// awaiting USER review]: f = damage*1.0 + kills*50 + survived*100, per
// battle. THIS IS THE ONE SHARED DEFINITION POINT for REQ-0068 (the
// season-end battle events squad): when REQ-0068 lands, it appends
// perSeason entries ({season, battles:[{damage,kills,survived}, ...]})
// to einherjar records, and battleScoreOf() below is the only formula
// that ever turns a battle into 戦果. No battle events exist yet, so
// every score today folds to 0 -- the degenerate-empty order is a
// first-class, tested state. Bump SCORE_FORMULA_VERSION whenever the
// weights change so stale order caches self-invalidate.
const SCORE_WEIGHTS = { damage: 1.0, kills: 50, survived: 100 };
const SCORE_FORMULA_VERSION = 1;

// Eternal Order tier thresholds (mock chip row: 奴僕 THRALL → 自由民 KARL
// → 族長 JARL → 選定者 EINHERJAR → 神域 VALHALLA). [TUNABLE][ORCH
// defaults]: 0 / 500 / 2000 / 8000. VALHALLA is deliberately NOT a
// score tier the server ever assigns -- its semantics (the mock renders
// it dimmed, beyond the ladder) are a client concern; the server's
// ladder tops out at EINHERJAR.
const ORDER_TIERS = [
  { tier: 'THRALL', min: 0 },
  { tier: 'KARL', min: 500 },
  { tier: 'JARL', min: 2000 },
  { tier: 'EINHERJAR', min: 8000 },
];

// Emblem placeholder (spec S2: "emblem(placeholder ok)") -- every order
// entry carries this single asset key until a real emblem system ships.
// The mock renders assets/emblem_horn3.png for every row today, so the
// placeholder IS the mock's own behavior.
const ORDER_EMBLEM_PLACEHOLDER = 'emblem_horn3';

const ORDER_TOP_DEFAULT = 10; // GET /order default top-N [TUNABLE]
const ORDER_TOP_MAX = 100; // GET /order top-N cap [TUNABLE]
const ORDER_AROUND_SPAN = 2; // around=me window: me +/- 2 rows [TUNABLE]

// A crashed rite's 'applying' lock is honored for this long before lazy
// recovery kicks in (see normalizeRiteRecord). [TUNABLE] -- same
// timeout-then-lazily-recover posture as services/core.cjs's
// WAREHOUSE_CLAIM_TIMEOUT_MS two-phase claim.
const RITE_LOCK_TIMEOUT_MS = 60 * 1000;

function playerNameOf(playerId) {
  const rec = players.readPlayer(playerId);
  return rec ? rec.name : playerId;
}

function deepCopy(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

module.exports = {
  SEASONS_PATH,
  SIS_PATH,
  RAGNAROK_DTO_VERSION,
  DAY_MS,
  RAGNAROK_DAWN_UTC_HOUR,
  SCORE_WEIGHTS,
  SCORE_FORMULA_VERSION,
  ORDER_TIERS,
  ORDER_EMBLEM_PLACEHOLDER,
  ORDER_TOP_DEFAULT,
  ORDER_TOP_MAX,
  ORDER_AROUND_SPAN,
  RITE_LOCK_TIMEOUT_MS,
  playerNameOf,
  deepCopy,
};
