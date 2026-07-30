'use strict';
// server/routes/bio.cjs -- REQ-0060: Pack Biography read/rename surface.
// Instance-scoped, AUTH'd counterpart to the public/static Dex Card API
// (REQ-0052 deferred kind:'bp'; a BP instance has no static content def --
// its history lives per-instance on the server; this is the auth'd,
// instance-scoped route REQ-0052's own note called for). ja strings are
// written as \uXXXX escapes (pure-ASCII source; JS decodes at runtime).
//   GET  /api/bio/:bpUid        -> { ok, bio: <DTO> }
//   POST /api/bio/:bpUid/name   -> append a carried name (rename history)
const { sendJSON } = require('../lib/http_util.cjs'); // REQ-0199: getAuthToken dropped (JWT-first resolver reads the req itself)
const { resolveCallerOr401, withJsonBody } = require('../lib/route_kit.cjs');
const storage = require('../storage.cjs');
const bio = require('../services/bio.cjs');
// REQ-0199: both handlers below resolve the caller through
// admin.resolveAuthFromRequest(req) -- a Supabase Bearer JWT first, then
// the REQ-0037 X-Auth-Token path + dev_mode fallback -- for parity with
// schedule/warehouse/profile. Previously the X-Auth-Token-ONLY resolver
// mis-resolved a JWT-only caller to the dev_mode fallback (the WRONG player).
// REQ-0349: that resolution is now lib/route_kit.cjs's resolveCallerOr401, so
// the parity is structural rather than copied. The wrong-method reply stays a
// 404 'not found' (not the kit's 405) -- that is this family's pre-REQ-0349
// behaviour and REQ-0349 changes no status codes. Byte-parity: this family's own
// 'bad body' / 'invalid json' wordings ride on withJsonBody as data until
// REQ-0349's unification commit.
const BODY_WORDING = { readFail: 'bad body', badJson: 'invalid json' };
const BIO_RE = /^\/api\/bio\/([^/]+)$/;
const BIO_NAME_RE = /^\/api\/bio\/([^/]+)\/name$/;
const I18N = {
  origin: {
    gacha: { en: 'Day one (gacha)', ja: '初日（ガチャ）' },
    sealed_seed: { en: 'Sealed seed', ja: '封印シード' },
    starter: { en: 'Starter job', ja: 'スタータージョブ' },
    field: { en: 'Found in the field', ja: '遠征で発見' },
    migration: { en: 'Legacy (pre-biography)', ja: 'レガシー（伝記導入前）' },
    unknown: { en: 'Unknown origin', ja: '出自不明' },
  },
  labels: {
    biography: { en: 'Biography', ja: '伝記' },
    born: { en: 'Born', ja: '誕生' },
    age: { en: 'Age', ja: '年齢' },
    runsSurvived: { en: 'Runs survived', ja: '生還した遠征' },
    wipesEndured: { en: 'Wipes endured', ja: '耐えた全滅' },
    bossesFelled: { en: 'Bosses felled', ja: '討伐したボス' },
    trapsDisarmedAboard: { en: 'Traps disarmed aboard', ja: '解除した罠' },
    chestsOpenedAboard: { en: 'Chests opened aboard', ja: '開けた宝箱' },
    damageTanked: { en: 'Damage tanked', ja: '受け止めた総ダメージ' },
    namesCarried: { en: 'Names carried', ja: '背負った名前' },
    dayOne: { en: 'Day one', ja: '初日から' },
    vetLuck: { en: 'Veteran luck', ja: '熟練の幸運' },
  },
};
function buildBioDto(doc) {
  const originKey = (doc.born && doc.born.origin) || 'unknown';
  return {
    v: 1, bp_uid: doc.bp_uid, born: doc.born, ageDays: bio.bioAgeDays(doc),
    dayOne: !!(doc.born && (doc.born.origin === 'gacha' || doc.born.origin === 'starter' || doc.born.origin === 'sealed_seed')),
    runsSurvived: doc.runsSurvived, wipesEndured: doc.wipesEndured, bossesFelled: doc.bossesFelled,
    trapsDisarmedAboard: doc.trapsDisarmedAboard, chestsOpenedAboard: doc.chestsOpenedAboard, damageTanked: doc.damageTanked,
    weathervaneRerolls: doc.weathervaneRerolls, chiselCellsAdded: doc.chiselCellsAdded, chiselCellsFiled: doc.chiselCellsFiled,
    namesCarried: doc.namesCarried || [], bioLuck: bio.bioLuck(doc), milestones: bio.bioMilestones(doc),
    originLabel: I18N.origin[originKey] || I18N.origin.unknown, i18n: I18N,
  };
}
function tryBioRoutes(req, res, url, p) {
  const mName = p.match(BIO_NAME_RE);
  if (mName) {
    if (req.method !== 'POST') { sendJSON(res, 404, { ok: false, error: 'not found' }); return; }
    const ctx = resolveCallerOr401(req, res);
    if (!ctx) return;
    const uid = decodeURIComponent(mName[1]);
    withJsonBody(req, res, BODY_WORDING, (body) => {
      const name = body && typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) { sendJSON(res, 400, { ok: false, error: 'name required' }); return; }
      const doc = bio.recordRename(uid, name);
      sendJSON(res, 200, { ok: true, bio: buildBioDto(doc) });
    });
    return;
  }
  const m = p.match(BIO_RE);
  if (!m) return false;
  if (req.method !== 'GET') { sendJSON(res, 404, { ok: false, error: 'not found' }); return; }
  if (!resolveCallerOr401(req, res)) return;
  const uid = decodeURIComponent(m[1]);
  const doc = storage.readBio(uid);
  if (!doc) { sendJSON(res, 404, { ok: false, error: 'no biography for bp: ' + uid }); return; }
  sendJSON(res, 200, { ok: true, bio: buildBioDto(doc) });
}
module.exports = { tryBioRoutes };
