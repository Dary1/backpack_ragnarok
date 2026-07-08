// eff_render.cjs -- shared effect-AST -> EN/JA renderer for backpack_ragnarok tools. (v3)
// Used by tool_gen_data.cjs and tool_build_preview.py (ported) to keep phrasing consistent.
//
// v3 changes:
//   - every_ticks REPLACED by every_secs: trigger.s is a [lo,hi] float range (seconds,
//     1-decimal). Rendered as "Every 1.4–1.7s: Strike 13–23." (en) /
//     "1.4〜1.7秒ごとに: 13〜23 ダメージ。" (ja).
//
// v2 changes (retained):
//   - Combat numerics are now 2-int ranges [lo,hi] (e.g. Strike [22,38] -> "Strike 22-38").
//   - Full vocab v2 coverage: new triggers (on_hit, on_bp_damaged) and new verbs
//     (multi_strike, buff_adjacent, cleanse, reflect_damage, lifesteal, haste, slow_enemy,
//     bonus_vs_blocked).
//   - New locale-aware API: render(effect, locale) and renderAll(effects, locale), locale in
//     {'en','ja'}. Legacy renderEffect/renderEntryEff (EN-only) are kept for tool_gen_data.cjs.
'use strict';

// ---------- helpers ----------

function isRange(v) {
  return Array.isArray(v) && v.length === 2 && Number.isInteger(v[0]) && Number.isInteger(v[1]);
}

function isNumRange(v) {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
}

// Formats a numeric param that may be a legacy scalar int or a v2 [lo,hi] range.
// Range -> "22-38" (en) using an en-dash; scalar -> "10".
function fmtNum(v, locale) {
  if (isRange(v)) {
    var dash = locale === 'ja' ? '〇'.replace('〇', '〜') : '–'; // JA wave dash / EN en-dash
    if (v[0] === v[1]) return String(v[0]);
    return v[0] + dash + v[1];
  }
  return String(v);
}

// Formats a seconds range [lo,hi] (floats, 1-decimal) -> "1.4–1.7" (en) / "1.4〜1.7" (ja).
function fmtSecs(v, locale) {
  var dash = locale === 'ja' ? '〜' : '–';
  if (!isNumRange(v)) return String(v);
  if (v[0] === v[1]) return String(v[0]);
  return v[0] + dash + v[1];
}

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

var TAG_KIND_EN = { type: 'type', element: 'element' };

// REQ-0093: status_kind class phrases (EN) -- one entry per closed
// 9-keyword vocab value (content/vocab.json "status_kinds"); singleton
// mechanical buckets are phrased by mechanism, not by hardcoding today's
// one member name, so phrasing stays correct if a second status is ever
// added to that bucket.
var STATUS_KIND_PHRASE_EN = {
  buff: 'all buffs',
  debuff: 'all debuffs',
  dot: 'anything burning/poisoned',
  hot: 'anything regenerating',
  cadence_slow: 'anything chilled',
  cadence_fast: 'anything hasted',
  onhit_reflect: 'anything with Spikes',
  suspend: 'anything stunned',
  dmg_reduce: 'anything weakened'
};

// =========================================================================
// English renderer
// =========================================================================

function verbPhraseEN(verb) {
  switch (verb.t) {
    case 'strike': return 'Strike ' + fmtNum(verb.n, 'en');
    case 'pulse': return 'emit a link pulse';
    case 'buff_linked': return '+' + fmtNum(verb.n, 'en') + ' ' + verb.stat + ' to ' + (verb.dir || 'out') + '-linked ' + verb.tag + ' items';
    case 'multi_strike': return 'Strike ' + fmtNum(verb.n, 'en') + ' x' + verb.hits;
    case 'block': return 'Block ' + fmtNum(verb.n, 'en');
    case 'heal_bp': return 'Heal this BP ' + fmtNum(verb.n, 'en');
    case 'apply_status': return 'apply ' + fmtNum(verb.n, 'en') + ' ' + verb.status;
    case 'add_on_hit_status': return 'apply ' + fmtNum(verb.n, 'en') + ' ' + verb.status;
    case 'amp_status': return verb.status + ' applications x' + verb.mult;
    case 'buff_host': return '+' + fmtNum(verb.n, 'en') + ' ' + verb.stat + ' to the host';
    case 'buff_self_per_tag':
      return '+' + fmtNum(verb.n, 'en') + ' ' + verb.stat + ' per other ' + verb.tag + ' ' +
        (TAG_KIND_EN[verb.tagKind] || verb.tagKind) + ' in this BP';
    case 'buff_adjacent':
      return '+' + fmtNum(verb.n, 'en') + ' ' + verb.stat + ' to adjacent ' + verb.tag + ' ' +
        (TAG_KIND_EN[verb.tagKind] || verb.tagKind) + ' items';
    case 'cleanse':
      return verb.n !== undefined ? 'cleanse ' + fmtNum(verb.n, 'en') + ' status stacks' : 'cleanse all negative statuses';
    case 'reflect_damage': return 'reflect ' + fmtNum(verb.n, 'en') + ' damage to attacker';
    case 'lifesteal': return 'heal self ' + fmtNum(verb.n, 'en') + ' on hit';
    case 'haste': return 'reduce tick interval by ' + fmtNum(verb.n, 'en');
    case 'slow_enemy': return 'slow enemy by ' + fmtNum(verb.n, 'en');
    case 'bonus_vs_blocked': return '+' + fmtNum(verb.n, 'en') + ' bonus damage vs blocked target';
    case 'status_immune':
      return 'immune: ' + (verb.status_kind ? (STATUS_KIND_PHRASE_EN[verb.status_kind] || verb.status_kind) : verb.status);
    case 'bonus_vs_status':
      return '+' + fmtNum(verb.n, 'en') + ' bonus damage vs ' + (verb.status_kind ? (STATUS_KIND_PHRASE_EN[verb.status_kind] || verb.status_kind) : verb.status);
    default: return verb.t;
  }
}

function triggerPrefixEN(trig) {
  switch (trig.t) {
    case 'every_secs': return 'Every ' + fmtSecs(trig.s, 'en') + 's: ';
    case 'on_link_pulse': return 'On link pulse: ';
    case 'battle_start': return 'Battle start: ';
    case 'passive': return '';
    case 'OnHit': return 'On hit: ';
    case 'OnPOHit': return 'On host PO hit: ';
    case 'OnBPHierarchyHit': return 'When this BP lands a hit: ';
    case 'OnUnitHit': return 'When this unit lands a hit: ';
    case 'OnBPBeenHit': return 'When this BP is damaged: ';
    case 'OnUnitBeenHit': return 'When this unit is damaged: ';
    case 'adjacent': return 'Adjacent ' + trig.tag + ': ';
    default: return trig.t + ': ';
  }
}

// Renders one effect object into a single English sentence, e.g.:
// "Every 1.8–2.2s: Strike 22-38 (when assembled)."
// "Adjacent Oil: Burn applications x2."
// "On host hit: apply 2-3 Chill."
// "+2-4 damage per other Beast PO in this BP."
function renderEffectEN(eff) {
  var trig = eff.trigger || {};
  var verb = eff.verb || {};
  var prefix = triggerPrefixEN(trig);
  var body = verbPhraseEN(verb);

  if (trig.t === 'adjacent') {
    if (verb.t === 'amp_status') {
      body = capitalize(body);
    } else if (verb.t === 'add_on_hit_status' || verb.t === 'apply_status') {
      body = capitalize(body) + ' on hit';
    } else {
      body = capitalize(body);
    }
    return prefix + body + '.';
  }

  if (trig.t === 'passive' && (verb.t === 'buff_self_per_tag' || verb.t === 'buff_host' || verb.t === 'buff_adjacent')) {
    return capitalize(body) + '.';
  }

  var sentence = prefix + capitalize(body);
  if (eff.cond === 'assembled') sentence += ' (when assembled)';
  sentence += '.';
  return sentence;
}

// =========================================================================
// Japanese renderer
// =========================================================================

var STATUS_JA = {
  Burn: '火傷', Poison: '毒', Chill: '氷結', Regen: '再生',
  Spikes: '棘', Stun: '気絶', Weakness: '衰弱', Haste: '加速'
};
var STAT_JA = { damage: 'ダメージ' };
var TAGKIND_JA = { type: 'タイプ', element: '属性' };

// REQ-0093: status_kind class phrases (JA) -- mirrors STATUS_KIND_PHRASE_EN.
var STATUS_KIND_PHRASE_JA = {
  buff: 'すべてのバフ',
  debuff: 'すべての衰弱効果',
  dot: '継続ダメージ状態（火傷・毒）',
  hot: '再生状態',
  cadence_slow: '氷結状態',
  cadence_fast: '加速状態',
  onhit_reflect: '棘（反射）状態',
  suspend: '気絶状態',
  dmg_reduce: '衰弱状態'
};

function statusJA(s) { return STATUS_JA[s] || s; }
function statJA(s) { return STAT_JA[s] || s; }

function verbPhraseJA(verb) {
  switch (verb.t) {
    case 'strike': return fmtNum(verb.n, 'ja') + ' ダメージ';
    case 'pulse': return 'リンクパルスを送出';
    case 'buff_linked': return (verb.dir || 'out') + '方向のリンク先の ' + verb.tag + ' に ' + statJA(verb.stat) + ' +' + fmtNum(verb.n, 'ja');
    case 'multi_strike': return fmtNum(verb.n, 'ja') + ' ダメージ ×' + verb.hits + '回';
    case 'block': return 'ブロック ' + fmtNum(verb.n, 'ja');
    case 'heal_bp': return 'このBPを ' + fmtNum(verb.n, 'ja') + ' 回復';
    case 'apply_status': return statusJA(verb.status) + ' ' + fmtNum(verb.n, 'ja') + ' 付与';
    case 'add_on_hit_status': return '命中時に ' + statusJA(verb.status) + ' ' + fmtNum(verb.n, 'ja') + ' 付与';
    case 'amp_status': return statusJA(verb.status) + ' 付与量 ×' + verb.mult;
    case 'buff_host': return '装備先に ' + statJA(verb.stat) + ' +' + fmtNum(verb.n, 'ja');
    case 'buff_self_per_tag':
      return 'このBP内の他の ' + verb.tag + '（' + (TAGKIND_JA[verb.tagKind] || verb.tagKind) + '）ごとに ' +
        statJA(verb.stat) + ' +' + fmtNum(verb.n, 'ja');
    case 'buff_adjacent':
      return '隣接する ' + verb.tag + '（' + (TAGKIND_JA[verb.tagKind] || verb.tagKind) + '）アイテムに ' +
        statJA(verb.stat) + ' +' + fmtNum(verb.n, 'ja');
    case 'cleanse':
      return verb.n !== undefined ? '状態異常を ' + fmtNum(verb.n, 'ja') + ' 段階解除' : '状態異常をすべて解除';
    case 'reflect_damage': return '攻撃者に ' + fmtNum(verb.n, 'ja') + ' ダメージ反射';
    case 'lifesteal': return '命中時に自身を ' + fmtNum(verb.n, 'ja') + ' 回復';
    case 'haste': return 'ティック間隔を ' + fmtNum(verb.n, 'ja') + ' 短縮';
    case 'slow_enemy': return '敵を ' + fmtNum(verb.n, 'ja') + ' 減速';
    case 'bonus_vs_blocked': return 'ブロック中の対象に追加ダメージ +' + fmtNum(verb.n, 'ja');
    case 'status_immune':
      return (verb.status_kind ? (STATUS_KIND_PHRASE_JA[verb.status_kind] || verb.status_kind) : statusJA(verb.status)) + 'に免疫';
    case 'bonus_vs_status':
      return (verb.status_kind ? (STATUS_KIND_PHRASE_JA[verb.status_kind] || verb.status_kind) : statusJA(verb.status)) + 'の相手に追加ダメージ +' + fmtNum(verb.n, 'ja');
    default: return verb.t;
  }
}

function triggerPrefixJA(trig) {
  switch (trig.t) {
    case 'every_secs': return fmtSecs(trig.s, 'ja') + '秒ごとに: ';
    case 'on_link_pulse': return 'リンクパルス受信時: ';
    case 'battle_start': return '戦闘開始時: ';
    case 'passive': return '';
    case 'OnHit': return '命中時: ';
    case 'OnPOHit': return '装備先POが命中した時: ';
    case 'OnBPHierarchyHit': return 'このBPが命中させた時: ';
    case 'OnUnitHit': return '所属ユニットが命中させた時: ';
    case 'OnBPBeenHit': return 'このBPが被弾した時: ';
    case 'OnUnitBeenHit': return '所属ユニットが被弾した時: ';
    case 'adjacent': return '隣接する' + trig.tag + ': ';
    default: return trig.t + ': ';
  }
}

// Renders one effect into a natural Japanese sentence, e.g.:
// "1.8〜2.2秒ごとに: 22〜38 ダメージ（組み立て時のみ）。"
// "隣接するOil: 火傷 付与量 x2。"
function renderEffectJA(eff) {
  var trig = eff.trigger || {};
  var verb = eff.verb || {};
  var prefix = triggerPrefixJA(trig);
  var body = verbPhraseJA(verb);

  if (trig.t === 'adjacent') {
    return prefix + body + '。';
  }

  var sentence = prefix + body;
  if (eff.cond === 'assembled') sentence += '（組み立て時のみ）';
  sentence += '。';
  return sentence;
}

// =========================================================================
// Public API
// =========================================================================

// render(effect, locale) -> string. locale in {'en','ja'}, defaults to 'en'.
function render(effect, locale) {
  if (locale === 'ja') return renderEffectJA(effect);
  return renderEffectEN(effect);
}

// renderAll(effects, locale) -> array of per-effect strings.
function renderAll(effects, locale) {
  return (effects || []).map(function (e) { return render(e, locale); });
}

// ---------- legacy EN-only API (kept for tool_gen_data.cjs compatibility) ----------

function renderEffect(eff) {
  return renderEffectEN(eff);
}

// Renders a full entry's effects array + optional flavor into the "eff" display string.
// effects joined with a space; flavor appended after " -- " if present.
function renderEntryEff(effects, flavor, opts) {
  opts = opts || {};
  var parts = (effects || []).map(renderEffectEN);
  var core = parts.join(' ');
  if (opts.prefixPart) core = (core ? opts.prefixPart + ' ' + core : opts.prefixPart);
  if (!core) core = opts.emptyText || '';
  if (flavor) return core ? (core + ' — ' + flavor) : flavor;
  return core;
}

module.exports = {
  render: render,
  renderAll: renderAll,
  renderEffect: renderEffect,
  renderEntryEff: renderEntryEff,
  verbPhrase: verbPhraseEN,
  triggerPrefix: triggerPrefixEN
};
