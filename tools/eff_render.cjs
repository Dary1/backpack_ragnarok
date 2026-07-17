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
    case 'buff_self': // REQ-0121
      return '+' + fmtNum(verb.n, 'en') + ' ' + verb.stat + ' to self';
    case 'damage_reduction': // REQ-0121
      return 'reduce incoming damage by ' + fmtNum(verb.n, 'en');
    case 'advance_cooldown': // REQ-0129 (AGENT-DEFINED unit charge effect; renders here, not yet engine-wired)
      return 'advance cooldown by ' + fmtNum(verb.n, 'en');
    case 'fire_items': // REQ-0129 (AGENT-DEFINED)
      return 'immediately fire ' + (verb.tag ? verb.tag + ' ' : '') + 'items';
    case 'grant_shield': // REQ-0129 (AGENT-DEFINED)
      return 'grant ' + fmtNum(verb.n, 'en') + ' shield';
    case 'grant_lifesteal': // REQ-0200 (AGENT-DEFINED unit charge effect)
      return 'grant lifesteal' + (verb.pct !== undefined ? ' ' + fmtNum(verb.pct, 'en') + '%' : '') +
        (verb.dur_s !== undefined ? ' for ' + fmtNum(verb.dur_s, 'en') + 's' : '');
    case 'heal_ally': // REQ-0203: enemy support -- heal a wounded pack ally
      return 'heal a wounded ally ' + fmtNum(verb.n, 'en');
    case 'charge_strike': // REQ-0212 (AGENT-DEFINED unit charge effect)
      return 'strike for ' + fmtNum(verb.n, 'en') + ' x stacks spent';
    case 'transfer_status': // REQ-0212 (AGENT-DEFINED)
      return 'transfer up to ' + fmtNum(verb.n, 'en') + ' negative statuses to the enemy';
    case 'shield_break': // REQ-0212 (AGENT-DEFINED)
      return 'break ' + fmtNum(verb.n, 'en') + ' enemy block';
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
    case 'OnSquadHit': return 'When this squad lands a hit: ';
    case 'OnBPBeenHit': return 'When this BP is damaged: ';
    case 'OnSquadBeenHit': return 'When this squad is damaged: ';
    case 'adjacent': return 'Adjacent ' + trig.tag + ': ';
    case 'on_hp_below': // REQ-0121: hp_frac 0.5 -> "Below 50% HP (once): "
      return 'Below ' + Math.round((trig.hp_frac || 0) * 100) + '% HP (once): ';
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
    case 'buff_self': // REQ-0121
      return '自身に ' + statJA(verb.stat) + ' +' + fmtNum(verb.n, 'ja');
    case 'damage_reduction': // REQ-0121
      return '受けるダメージを ' + fmtNum(verb.n, 'ja') + ' 軽減';
    case 'advance_cooldown': // REQ-0129 (AGENT-DEFINED unit charge effect)
      return 'クールダウンを ' + fmtNum(verb.n, 'ja') + ' 進める';
    case 'fire_items': // REQ-0129 (AGENT-DEFINED)
      return (verb.tag ? verb.tag + ' ' : '') + 'アイテムを即時発動';
    case 'grant_shield': // REQ-0129 (AGENT-DEFINED)
      return 'シールドを ' + fmtNum(verb.n, 'ja') + ' 付与';
    case 'grant_lifesteal': // REQ-0200 (AGENT-DEFINED unit charge effect)
      return 'ライフスティール' + (verb.pct !== undefined ? ' ' + fmtNum(verb.pct, 'ja') + '%' : '') +
        (verb.dur_s !== undefined ? '（' + fmtNum(verb.dur_s, 'ja') + '秒）' : '') + '付与';
    case 'heal_ally': // REQ-0203: enemy support -- heal a wounded pack ally
      return '負傷した味方を ' + fmtNum(verb.n, 'ja') + ' 回復';
    case 'charge_strike': // REQ-0212 (AGENT-DEFINED unit charge effect)
      return fmtNum(verb.n, 'ja') + ' × 消費スタック ダメージ';
    case 'transfer_status': // REQ-0212 (AGENT-DEFINED)
      return '負の状態異常を最大 ' + fmtNum(verb.n, 'ja') + ' 個 敵に移送';
    case 'shield_break': // REQ-0212 (AGENT-DEFINED)
      return '敵のブロックを ' + fmtNum(verb.n, 'ja') + ' 破壊';
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
    case 'OnSquadHit': return '所属ユニットが命中させた時: ';
    case 'OnBPBeenHit': return 'このBPが被弾した時: ';
    case 'OnSquadBeenHit': return '所属ユニットが被弾した時: ';
    case 'adjacent': return '隣接する' + trig.tag + ': ';
    case 'on_hp_below': // REQ-0121
      return 'HPが' + Math.round((trig.hp_frac || 0) * 100) + '%を下回った時（一度だけ）: ';
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
// REQ-0200: unit `charge` block renderer (AST-first tooltip text). A charge
// block is {trigger, gain, capacity, spend, effects|transform_to}. Rendered as
// three parts: a trigger line, a capacity/spend line, then one line per effect
// (verb phrase + target). In UNIT CHARGE context the ranged verb params are
// n / hits / pct / dur_s (a def carries `pct` where the item form carries `n`),
// so charge effects get their OWN verb phrasing here rather than reusing the
// item verbPhrase (which reads verb.n / verb.stat).
// =========================================================================

// Range formatter that accepts int OR float [lo,hi] (pct like [0.1,0.2] is float).
function fmtAny(v, locale) {
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
    var dash = locale === 'ja' ? '〜' : '–';
    return v[0] === v[1] ? String(v[0]) : v[0] + dash + v[1];
  }
  return String(v);
}
function pctOf(verb, locale) {
  var p = verb.pct !== undefined ? verb.pct : verb.n;
  return fmtAny(p, locale) + '%';
}

var CHARGE_TRIG_EN = {
  every_secs: function (t) { return 'every ' + fmtAny(t.s, 'en') + 's'; },
  OnHit: function () { return 'on hit'; },
  OnBPBeenHit: function () { return 'when this BP is damaged'; },
  on_damage_dealt: function () { return 'when this BP deals damage'; },
  on_connected_unit_spend: function () { return 'when a linked unit spends charge'; },
  on_connected_unit_attack: function () { return 'when a linked unit attacks'; },
  on_connected_unit_bp_been_hit: function () { return "when a linked unit's BP is damaged"; },
  on_own_passive_fire: function () { return "when this unit's own passive fires"; },
  on_heal_done: function () { return 'when this BP heals'; },
  on_status_applied: function () { return 'when this BP applies a status'; },
  on_kill: function () { return 'on kill'; }
};
var CHARGE_TRIG_JA = {
  every_secs: function (t) { return fmtAny(t.s, 'ja') + '秒ごとに'; },
  OnHit: function () { return '命中時'; },
  OnBPBeenHit: function () { return 'このBPが被弾した時'; },
  on_damage_dealt: function () { return 'このBPがダメージを与えた時'; },
  on_connected_unit_spend: function () { return 'リンク先ユニットがチャージを使った時'; },
  on_connected_unit_attack: function () { return 'リンク先ユニットが攻撃した時'; },
  on_connected_unit_bp_been_hit: function () { return 'リンク先ユニットのBPが被弾した時'; },
  on_own_passive_fire: function () { return '自身のパッシブが発動した時'; },
  on_heal_done: function () { return 'このBPが回復した時'; },
  on_status_applied: function () { return 'このBPが状態を付与した時'; },
  on_kill: function () { return '撃破時'; }
};

var CHARGE_TARGET_EN = {
  self: 'self',
  units_connected: 'linked units',
  bp_connected: 'linked BPs',
  units_connected_distributed: 'linked units (split)',
  bp_connected_max_cooldown_item: 'the slowest linked item',
  bp_connected_lowest_hp: 'the most-hurt linked BP'
};
var CHARGE_TARGET_JA = {
  self: '自身',
  units_connected: 'リンク先ユニット',
  bp_connected: 'リンク先BP',
  units_connected_distributed: 'リンク先ユニット（分配）',
  bp_connected_max_cooldown_item: '最長クールダウンのリンク先アイテム',
  bp_connected_lowest_hp: '最も傷ついたリンク先BP'
};

function chargeEffectPhraseEN(v) {
  switch (v.t) {
    case 'add_on_hit_status': return 'grant ' + fmtAny(v.n, 'en') + ' ' + v.status + ' on hit';
    case 'apply_status': return 'apply ' + fmtAny(v.n, 'en') + ' ' + v.status;
    case 'amp_status': return 'amplify ' + v.status + (v.n !== undefined ? ' by ' + fmtAny(v.n, 'en') : '');
    case 'haste': return 'haste ' + fmtAny(v.n, 'en');
    case 'cleanse': return 'cleanse';
    case 'heal_bp': return 'heal ' + fmtAny(v.n, 'en');
    case 'block': return 'block ' + fmtAny(v.n, 'en');
    case 'strike': return 'strike ' + fmtAny(v.n, 'en');
    case 'multi_strike': return 'strike ' + fmtAny(v.n, 'en') + ' × ' + fmtAny(v.hits, 'en');
    case 'reflect_damage': return 'reflect ' + pctOf(v, 'en') + ' damage';
    case 'damage_reduction': return 'reduce incoming damage by ' + pctOf(v, 'en');
    case 'status_immune': return 'immune to ' + v.status;
    case 'bonus_vs_status': return '+' + pctOf(v, 'en') + ' damage vs ' + (v.status === 'any' ? 'afflicted foes' : v.status);
    case 'buff_self': return '+' + pctOf(v, 'en') + ' damage to self';
    case 'buff_linked': return '+' + pctOf(v, 'en') + ' damage to linked';
    case 'grant_charge': return 'grant ' + fmtAny(v.n, 'en') + ' charge';
    case 'grant_shield': return 'grant ' + fmtAny(v.n, 'en') + ' shield';
    case 'grant_lifesteal': return 'grant ' + pctOf(v, 'en') + ' lifesteal' + (v.dur_s !== undefined ? ' for ' + fmtAny(v.dur_s, 'en') + 's' : '');
    case 'advance_cooldown': return 'advance cooldown by ' + fmtAny(v.n, 'en');
    case 'fire_items': return 'fire ' + (v.tag ? v.tag + ' ' : '') + 'items';
    case 'charge_strike': return 'strike for ' + fmtAny(v.n, 'en') + ' × stacks spent';
    case 'transfer_status': return 'transfer up to ' + fmtAny(v.n, 'en') + ' negative statuses to the enemy';
    case 'shield_break': return 'break ' + fmtAny(v.n, 'en') + ' enemy block';
    default: return v.t;
  }
}
function chargeEffectPhraseJA(v) {
  var st = (typeof STATUS_JA !== 'undefined' && STATUS_JA[v.status]) ? STATUS_JA[v.status] : v.status;
  switch (v.t) {
    case 'add_on_hit_status': return '命中時に ' + st + ' ' + fmtAny(v.n, 'ja') + ' 付与';
    case 'apply_status': return st + ' ' + fmtAny(v.n, 'ja') + ' 付与';
    case 'amp_status': return st + ' 増幅' + (v.n !== undefined ? ' ' + fmtAny(v.n, 'ja') : '');
    case 'haste': return '加速 ' + fmtAny(v.n, 'ja');
    case 'cleanse': return '状態異常を解除';
    case 'heal_bp': return fmtAny(v.n, 'ja') + ' 回復';
    case 'block': return 'ブロック ' + fmtAny(v.n, 'ja');
    case 'strike': return fmtAny(v.n, 'ja') + ' ダメージ';
    case 'multi_strike': return fmtAny(v.n, 'ja') + ' ダメージ ×' + fmtAny(v.hits, 'ja');
    case 'reflect_damage': return pctOf(v, 'ja') + ' ダメージ反射';
    case 'damage_reduction': return '受けるダメージを ' + pctOf(v, 'ja') + ' 軽減';
    case 'status_immune': return st + 'に免疫';
    case 'bonus_vs_status': return (v.status === 'any' ? '状態異常の敵' : st + 'の敵') + 'に追加ダメージ +' + pctOf(v, 'ja');
    case 'buff_self': return '自身に ダメージ +' + pctOf(v, 'ja');
    case 'buff_linked': return 'リンク先に ダメージ +' + pctOf(v, 'ja');
    case 'grant_charge': return 'チャージを ' + fmtAny(v.n, 'ja') + ' 付与';
    case 'grant_shield': return 'シールドを ' + fmtAny(v.n, 'ja') + ' 付与';
    case 'grant_lifesteal': return 'ライフスティール ' + pctOf(v, 'ja') + (v.dur_s !== undefined ? '（' + fmtAny(v.dur_s, 'ja') + '秒）' : '') + ' 付与';
    case 'advance_cooldown': return 'クールダウンを ' + fmtAny(v.n, 'ja') + ' 進める';
    case 'fire_items': return (v.tag ? v.tag + ' ' : '') + 'アイテムを即時発動';
    case 'charge_strike': return fmtAny(v.n, 'ja') + ' × 消費スタック ダメージ';
    case 'transfer_status': return '負の状態異常を最大 ' + fmtAny(v.n, 'ja') + ' 個 敵に移送';
    case 'shield_break': return '敵のブロックを ' + fmtAny(v.n, 'ja') + ' 破壊';
    default: return v.t;
  }
}

function renderChargeEN(charge) {
  var trig = charge.trigger || {};
  var tf = CHARGE_TRIG_EN[trig.t];
  var gain = charge.gain === 'damage' ? 'gain = damage dealt' : '+1 per trigger';
  var lines = ['Charge — ' + (tf ? tf(trig) : trig.t) + ' (' + gain + ').'];
  var cap = fmtAny(charge.capacity, 'en');
  if (charge.spend === 'passive_per_stack') lines.push('Standing effect, per stack (max ' + cap + '):');
  else if (charge.spend === 'transform') lines.push('At ' + cap + ', transform into ' + (charge.transform_to || '?') + '.');
  else lines.push('At ' + cap + ', fire:');
  for (var i = 0; i < (charge.effects || []).length; i++) {
    var e = charge.effects[i];
    lines.push('  • ' + chargeEffectPhraseEN(e.verb || {}) + ' → ' + (CHARGE_TARGET_EN[e.target] || e.target));
  }
  return lines.join('\n');
}
function renderChargeJA(charge) {
  var trig = charge.trigger || {};
  var tf = CHARGE_TRIG_JA[trig.t];
  var gain = charge.gain === 'damage' ? 'ダメージ量を蓄積' : '発動ごとに+1';
  var lines = ['チャージ — ' + (tf ? tf(trig) : trig.t) + '（' + gain + '）。'];
  var cap = fmtAny(charge.capacity, 'ja');
  if (charge.spend === 'passive_per_stack') lines.push('スタックごとの常時効果（最大 ' + cap + '）:');
  else if (charge.spend === 'transform') lines.push(cap + ' で ' + (charge.transform_to || '?') + ' に変身。');
  else lines.push(cap + ' で発動:');
  for (var i = 0; i < (charge.effects || []).length; i++) {
    var e = charge.effects[i];
    lines.push('  • ' + chargeEffectPhraseJA(e.verb || {}) + ' → ' + (CHARGE_TARGET_JA[e.target] || e.target));
  }
  return lines.join('\n');
}

// renderCharge(charge, locale) -> multi-line tooltip string. locale in {'en','ja'}.
function renderCharge(charge, locale) {
  if (!charge || typeof charge !== 'object') return '';
  return locale === 'ja' ? renderChargeJA(charge) : renderChargeEN(charge);
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
  renderCharge: renderCharge,
  renderEffect: renderEffect,
  renderEntryEff: renderEntryEff,
  verbPhrase: verbPhraseEN,
  triggerPrefix: triggerPrefixEN
};
