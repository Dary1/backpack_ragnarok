'use strict';
// shared/content_validate.cjs -- REQ-0047 (b): THE content-edit validator.
// Moved VERBATIM from server/admin.cjs (REQ-0038 era) -- this module is
// the single executable source of truth for what an admin PUT may
// contain. Dependency-free. Throws descriptive Errors; never coerces.
// Consumed by: server/admin.cjs (HTTP 400 surface). Vocab is passed in
// by the caller (content/vocab.json) -- this module does no file I/O.

// REQ-0038: formal i18n adoption. `i18n` (a map keyed by locale, e.g.
// {ja: {name, flavor}}) is now the primary editable locale-content field;
// name_ja/flavor_ja stay in the allowlist too (back-compat -- content/
// live/*.json itself no longer has them post-migration, but an old
// client/script/test PUTting the flat shape is still accepted and still
// round-trips through server/api.cjs's withBackCompatI18n() on the next
// GET /api/content, so nothing regresses for stale callers).
const SUPPORTED_LOCALES = new Set(['ja']);
const ITEM_ALLOWED_KEYS = new Set([
  'name', 'name_ja', 'flavor', 'flavor_ja', 'i18n', 'rarity', 'tags', 'effects', 'sockets', 'stretch',
]);
const SI_ALLOWED_KEYS = new Set([
  'name', 'name_ja', 'flavor', 'flavor_ja', 'i18n', 'rarity', 'effects',
]);
// REQ-0170: unit/1 (docs/llm_managed/unit_icon_pipeline.md section 4.2, RATIFIED
// 2026-07-14). Deliberately ABSENT: `charge` and `effects` (the grammar is frozen but
// the engine has no charge AST -- a def field nothing evaluates is fiction), and
// `sockets` (REMOVED by user ruling; demoted to REQ-0163, unratified). Adding either
// to this allowlist without the code that honours it is the failure mode this REQ
// exists to end.
const UNIT_ALLOWED_KEYS = new Set([
  'name', 'name_ja', 'flavor', 'flavor_ja', 'i18n', 'rarity', 'connection_shape',
]);

function isFiniteNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validates a [lo,hi] numeric range: must be a 2-element array of finite
 * numbers, lo <= hi, both > 0. Used for both trigger.s (seconds) and
 * verb.n (any ranged verb param), per vocab.json's ranged_verb_params. */
function isValidRange(v) {
  if (!Array.isArray(v) || v.length !== 2) return false;
  const [lo, hi] = v;
  if (!isFiniteNum(lo) || !isFiniteNum(hi)) return false;
  if (lo <= 0 || hi <= 0) return false;
  if (lo > hi) return false;
  return true;
}

/** Validates one effect object against vocab.json's closed vocabulary +
 * range rules. Throws a descriptive Error (message surfaced to the
 * client as the 400 body) on any violation -- never silently coerces. */
function validateEffect(eff, vocab, ctx) {
  if (!eff || typeof eff !== 'object') throw new Error(ctx + ': effect must be an object');
  const trig = eff.trigger;
  if (!trig || typeof trig !== 'object' || typeof trig.t !== 'string') {
    throw new Error(ctx + ': effect.trigger.t is required');
  }
  if (!vocab.triggers.includes(trig.t)) {
    throw new Error(ctx + ': unknown trigger type "' + trig.t + '"');
  }
  if (trig.t === 'every_secs') {
    if (!isValidRange(trig.s)) {
      throw new Error(ctx + ': trigger.s must be a [lo,hi] range with 0 < lo <= hi');
    }
  }
  // REQ-0121: on_hp_below carries hp_frac -- a strict fraction of hpMax,
  // must be a finite number in the OPEN interval (0, 1). 0 could never
  // fire (hp/hpMax < 0 is impossible for a living actor) and 1 would fire
  // on the first scratch -- both are authoring mistakes, rejected here.
  if (trig.t === 'on_hp_below') {
    if (!isFiniteNum(trig.hp_frac) || trig.hp_frac <= 0 || trig.hp_frac >= 1) {
      throw new Error(ctx + ': trigger.hp_frac must be a number in (0, 1)');
    }
  }
  const verb = eff.verb;
  if (!verb || typeof verb !== 'object' || typeof verb.t !== 'string') {
    throw new Error(ctx + ': effect.verb.t is required');
  }
  if (!vocab.verbs.includes(verb.t)) {
    throw new Error(ctx + ': unknown verb type "' + verb.t + '"');
  }
  if (verb.n !== undefined) {
    if (!isValidRange(verb.n)) {
      throw new Error(ctx + ': verb.n must be a [lo,hi] range with 0 < lo <= hi');
    }
  }
  if (verb.status !== undefined && !vocab.statuses.includes(verb.status)) {
    throw new Error(ctx + ': unknown status "' + verb.status + '"');
  }
  if (eff.cond !== undefined && eff.cond !== 'assembled') {
    throw new Error(ctx + ': unknown effect.cond "' + eff.cond + '"');
  }
}

/** Validates the i18n map: must be a plain object whose keys are all in
 * SUPPORTED_LOCALES (today just {"ja"} -- REQ-0038: "whitelist i18n map
 * keys to a fixed locale set {ja} for now"). Each locale's value must
 * itself be a plain object with only name/flavor keys, each a string
 * when present -- same per-field type rule the base name/flavor fields
 * already get. Throws a descriptive Error on any violation. */
function validateI18n(i18n, ctx, locales) {
  // REQ-0184: `locales` is OPTIONAL and defaults to SUPPORTED_LOCALES, so every
  // pre-existing caller (the admin PUT surface for po/si) keeps the exact {ja}
  // whitelist it had. It exists because the DUNGEON dialect legitimately writes
  // {en, ja} -- content/live/dungeon/{enemies,formations}.json have always done
  // so -- and REQ-0161 settled that a validator learns the dialect of the data
  // the game actually serves rather than the data being bent to the validator.
  // Widening SUPPORTED_LOCALES itself would silently widen what an admin PUT may
  // write for items/SIs: a side effect no REQ asked for.
  const allowed = locales || SUPPORTED_LOCALES;
  if (!i18n || typeof i18n !== 'object' || Array.isArray(i18n)) {
    throw new Error(ctx + ': i18n must be an object');
  }
  for (const locale of Object.keys(i18n)) {
    if (!allowed.has(locale)) {
      throw new Error(ctx + ': unknown i18n locale "' + locale + '" (supported: ' + Array.from(allowed).join(', ') + ')');
    }
    const entry = i18n[locale];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(ctx + ': i18n.' + locale + ' must be an object');
    }
    for (const key of Object.keys(entry)) {
      if (key !== 'name' && key !== 'flavor') {
        throw new Error(ctx + ': unknown field "' + key + '" in i18n.' + locale + ' (only name/flavor are editable)');
      }
    }
    if (entry.name !== undefined && typeof entry.name !== 'string') {
      throw new Error(ctx + ': i18n.' + locale + '.name must be a string');
    }
    if (entry.flavor !== undefined && typeof entry.flavor !== 'string') {
      throw new Error(ctx + ': i18n.' + locale + '.flavor must be a string');
    }
  }
}

/** Validates one socket object (PO only) against vocab.json's socket_tags
 * tree. */
function validateSocket(sock, vocab, ctx) {
  if (!sock || typeof sock !== 'object' || typeof sock.t !== 'string') {
    throw new Error(ctx + ': socket.t is required');
  }
  if (!(sock.t in vocab.socket_tags)) {
    throw new Error(ctx + ': unknown socket type "' + sock.t + '"');
  }
  if (sock.tags !== undefined) {
    if (!Array.isArray(sock.tags)) throw new Error(ctx + ': socket.tags must be an array');
    for (const t of sock.tags) {
      if (!(t in vocab.socket_tags)) throw new Error(ctx + ': unknown socket tag "' + t + '"');
    }
  }
  if (sock.ax !== undefined && !isFiniteNum(sock.ax)) throw new Error(ctx + ': socket.ax must be a finite number');
  if (sock.ay !== undefined && !isFiniteNum(sock.ay)) throw new Error(ctx + ': socket.ay must be a finite number');
}

/** Validates the full PUT body against the schema allowlist for `kind`
 * ('item' or 'si') plus every closed-vocabulary/range rule. Throws on the
 * first violation found (message becomes the 400 response body's
 * `error`). Never mutates `body`. */
function validateBody(body, kind, vocab) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('body must be a JSON object');
  }
  const allowed = kind === 'item' ? ITEM_ALLOWED_KEYS
    : kind === 'unit' ? UNIT_ALLOWED_KEYS
    : SI_ALLOWED_KEYS;
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new Error('unknown field "' + key + '" is not editable via this endpoint');
    }
  }
  if (body.rarity !== undefined) {
    if (!vocab.rarities.includes(body.rarity)) {
      throw new Error('unknown rarity "' + body.rarity + '"');
    }
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length === 0) {
      throw new Error('tags must be a non-empty array');
    }
    for (const t of body.tags) {
      if (!(t in vocab.po_tags)) throw new Error('unknown tag "' + t + '"');
    }
    // tags[0] is explicitly the type root (project convention -- every
    // live item entry's tags[0] is a po_tag with a null parent).
    if (vocab.po_tags[body.tags[0]] !== null) {
      throw new Error('tags[0] ("' + body.tags[0] + '") must be a root tag (null parent in vocab.po_tags)');
    }
  }
  if (body.effects !== undefined) {
    if (!Array.isArray(body.effects)) throw new Error('effects must be an array');
    body.effects.forEach((eff, i) => validateEffect(eff, vocab, 'effects[' + i + ']'));
  }
  if (body.sockets !== undefined) {
    if (!Array.isArray(body.sockets)) throw new Error('sockets must be an array');
    body.sockets.forEach((s, i) => validateSocket(s, vocab, 'sockets[' + i + ']'));
  }
  if (body.stretch !== undefined && typeof body.stretch !== 'boolean') {
    throw new Error('stretch must be a boolean');
  }
  for (const k of ['name', 'name_ja', 'flavor', 'flavor_ja']) {
    if (body[k] !== undefined && typeof body[k] !== 'string') {
      throw new Error(k + ' must be a string');
    }
  }
  if (body.i18n !== undefined) {
    validateI18n(body.i18n, 'i18n');
  }
  // REQ-0170: a unit's connection_shape must be a key of the RATIFIED table. This is
  // the closed-vocabulary rule that makes `connection_shape` mean something: an
  // unknown key would resolve to null at walk time and the Unit would silently form
  // no links -- a def that lies quietly instead of failing loudly.
  if (body.connection_shape !== undefined) {
    const shapes = vocab.connection_shapes || {};
    if (typeof body.connection_shape !== 'string' || !(body.connection_shape in shapes)) {
      throw new Error('unknown connection_shape "' + body.connection_shape + '" (must be a key of vocab.connection_shapes)');
    }
  }
}

/** REQ-0170: validates ONE whole `unit/1` entry as it appears in
 * content/live/live_units.json -- i.e. including the fields validateBody() does not
 * cover because an admin PUT may not edit them (`id`, `icon`). `icon` is a FREE
 * reference to an artwork system_name: it is NOT derived from `id` (two defs share
 * one artwork -- REQ-0149 G14), so the one thing this must never do is assert
 * icon === 'icon-' + id. Throws on the first violation. */
function validateUnitEntry(entry, vocab) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('unit entry must be an object');
  if (typeof entry.id !== 'string' || !entry.id) throw new Error('unit entry: id is required');
  const ctx = 'unit "' + entry.id + '"';
  if (typeof entry.name !== 'string' || !entry.name) throw new Error(ctx + ': name is required');
  if (typeof entry.icon !== 'string' || !entry.icon) throw new Error(ctx + ': icon is required (an artwork system_name; illustration-first)');
  if (typeof entry.connection_shape !== 'string') throw new Error(ctx + ': connection_shape is required');
  if (!entry.i18n || !entry.i18n.ja || typeof entry.i18n.ja.name !== 'string') {
    throw new Error(ctx + ': i18n.ja.name is MANDATORY on every entry (pipeline rule)');
  }
  const body = {};
  for (const k of Object.keys(entry)) {
    if (k === 'id' || k === 'icon') continue; // not editable via the admin surface; checked above
    body[k] = entry[k];
  }
  validateBody(body, 'unit', vocab);
}

/** REQ-0170: validates ONE `gacha_pack/1` entry (content/live/live_packs.json).
 * `unitIds` is the set of ids that actually exist in live_units.json -- a pool row
 * naming a unit that does not exist is the single most dangerous thing a pack can
 * contain, because the roll would either crash or silently skip it. */
function validatePackEntry(pack, unitIds, contentIds) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new Error('pack entry must be an object');
  if (typeof pack.id !== 'string' || !pack.id) throw new Error('pack entry: id is required');
  const ctx = 'pack "' + pack.id + '"';
  if (!Number.isFinite(pack.cost) || pack.cost < 0) throw new Error(ctx + ': cost must be a non-negative number');
  if (pack.cells !== undefined) {
    if (!Array.isArray(pack.cells) || pack.cells.length !== 2 ||
        !Number.isInteger(pack.cells[0]) || !Number.isInteger(pack.cells[1]) ||
        pack.cells[0] < 1 || pack.cells[1] < pack.cells[0]) {
      throw new Error(ctx + ': cells must be [min,max] integers with 1 <= min <= max');
    }
  }
  if (pack.hp_per_cell !== undefined && (!Number.isFinite(pack.hp_per_cell) || pack.hp_per_cell <= 0)) {
    throw new Error(ctx + ': hp_per_cell must be a positive number');
  }
  if (!Array.isArray(pack.pool) || pack.pool.length === 0) throw new Error(ctx + ': pool must be a non-empty array');
  let total = 0;
  for (const row of pack.pool) {
    if (!row || typeof row.unit !== 'string') throw new Error(ctx + ': every pool row needs a unit id');
    if (!unitIds.has(row.unit)) throw new Error(ctx + ': pool names unit "' + row.unit + '", which has no live def');
    if (!Number.isFinite(row.weight) || row.weight <= 0) throw new Error(ctx + ': pool row "' + row.unit + '" needs a positive weight');
    total += row.weight;
  }
  if (!(total > 0)) throw new Error(ctx + ': pool weights must sum to a positive number');
  // REQ-0062: bonus slots (0..2). Each slot draws ONE weighted entry from its own
  // table (a PO / SI lens / TM stack) -- the "synergy bundle" atop the guaranteed BP.
  // The tables are TRANSPARENT ODDS (surfaced on the pack's Dex card + Workshop odds
  // view), so this gate is what keeps a listed table honest: every id must reference
  // REAL live content (when contentIds is supplied), or the roll advertises something
  // that can never drop.
  if (pack.bonus !== undefined) {
    if (!Array.isArray(pack.bonus) || pack.bonus.length > 2) {
      throw new Error(ctx + ': bonus must be an array of 0..2 slots');
    }
    const POOLS = { po: 'po', si: 'si', tm: 'tm' };
    pack.bonus.forEach((slot, bi) => {
      const sctx = ctx + ' bonus[' + bi + ']';
      if (!slot || typeof slot !== 'object' || Array.isArray(slot)) throw new Error(sctx + ': must be an object');
      if (!POOLS[slot.pool]) throw new Error(sctx + ': pool must be one of po|si|tm, got ' + JSON.stringify(slot.pool));
      if (!Array.isArray(slot.table) || slot.table.length === 0) throw new Error(sctx + ': table must be a non-empty array');
      let btotal = 0;
      for (const row of slot.table) {
        if (!row || typeof row.id !== 'string' || !row.id) throw new Error(sctx + ': every table row needs an id');
        if (!Number.isFinite(row.weight) || row.weight <= 0) throw new Error(sctx + ': table row "' + row.id + '" needs a positive weight');
        if (row.qty !== undefined) {
          if (!Number.isInteger(row.qty) || row.qty <= 0) throw new Error(sctx + ': table row "' + row.id + '" qty must be a positive integer');
          if (slot.pool !== 'tm' && row.qty !== 1) throw new Error(sctx + ': only tm rows may carry qty > 1 (po/si draw one instance)');
        }
        if (contentIds) {
          const known = contentIds[slot.pool];
          if (known && !known.has(row.id)) throw new Error(sctx + ': references ' + slot.pool + ' "' + row.id + '", which has no live content def');
        }
        btotal += row.weight;
      }
      if (!(btotal > 0)) throw new Error(sctx + ': table weights must sum to a positive number');
    });
  }
}


// =====================================================================
// REQ-0184: monster_pack/1 -- a pack is a LAYOUT of monsters on the
// battle field. THE single executable definition of "a legal pack
// layout", imported by BOTH server/services/content_checks.cjs (the
// machine check) and sim/lib/packs.cjs (the placer). Two copies of this
// rule would drift, and the drift would be invisible -- the REQ-0171
// lesson, applied before it can bite.
//
// GEOMETRY (user ruling, 2026-07-15). The battle field is 26x18 =
// A1:Z18 (sim/lib/field.cjs FIELD_COLS=26, FIELD_ROWS=18). It carries a
// MARGIN of 1 on every side, so the PLACEABLE area is 24x16 = B2:Y17 --
// exactly the box formations.json already draws player canvases in.
// These constants are duplicated here rather than require()d from
// sim/lib/field.cjs on purpose: shared/ may not require() out of shared/
// (the same rule sim/tests/forecast_parity.cjs documents in its header),
// so a parity test pins them equal instead of a cross-tree import.
const FIELD_COLS = 26, FIELD_ROWS = 18;
const PLACEABLE = { colMin: 2, rowMin: 2, colMax: FIELD_COLS - 1, rowMax: FIELD_ROWS - 1 };

// The DUNGEON dialect's locale set. content/live/dungeon/*.json has always
// carried both en and ja (enemies.json, formations.json, skills.json), unlike
// the po/si admin surface whose editable locale set is {ja}. monster_pack/1 is
// dungeon content, so it speaks the dungeon dialect (REQ-0161 doctrine).
const DUNGEON_LOCALES = new Set(['en', 'ja']);

/** "F5" -> {row:5, col:6}. Column letters are A..Z (1-based, A=1); the row
 * is 1-based. Returns null for anything that is not a well-formed token --
 * callers turn that into their own descriptive error. Multi-letter columns
 * are deliberately NOT accepted: the field is 26 wide, so a second letter
 * is always an authoring mistake, and silently parsing "AA1" would place a
 * monster off the board. */
function parseA1(tok) {
  if (typeof tok !== 'string') return null;
  const m = /^([A-Z])([0-9]{1,2})$/.exec(tok);
  if (!m) return null;
  const col = m[1].charCodeAt(0) - 64; // 'A' -> 1
  const row = parseInt(m[2], 10);
  if (!Number.isInteger(row) || row < 1) return null;
  return { row: row, col: col };
}

/** {row,col} -> "F5". The exact inverse of parseA1 (a round-trip test pins
 * it), so a layout the admin edits and the sim reads spell the same cell. */
function formatA1(row, col) {
  return String.fromCharCode(64 + col) + String(row);
}

/** The cells a member actually occupies: its anchor is the TOP-LEFT, and
 * the footprint [fh, fw] grows down/right -- the identical convention
 * compileEnemyPack() has always used. Derived, never stored: a def that
 * stored both anchor and cells would start lying the day its footprint
 * changed. */
function cellsFor(anchor, footprint) {
  const fp = Array.isArray(footprint) ? footprint : [1, 1];
  const fh = Number.isInteger(fp[0]) && fp[0] > 0 ? fp[0] : 1;
  const fw = Number.isInteger(fp[1]) && fp[1] > 0 ? fp[1] : 1;
  const cells = [];
  for (let dr = 0; dr < fh; dr++) for (let dc = 0; dc < fw; dc++) cells.push([anchor.row + dr, anchor.col + dc]);
  return cells;
}

/** Validates one monster_pack/1 entry. Throws a descriptive Error naming the
 * offending member -- never coerces, never silently drops.
 *
 * `enemyDefs` maps enemy id -> def (needs `footprint`); when supplied, every
 * member `enemy` must resolve, because a pack that names a monster with no
 * def either crashes the compiler or silently fields a smaller pack -- and
 * nothing else in the chain would ever say so. Pass null to skip the
 * reference check (shape-only validation).
 */
function validateMonsterPackEntry(pack, enemyDefs) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new Error('monster_pack entry must be an object');
  if (typeof pack.id !== 'string' || !pack.id) throw new Error('monster_pack entry: id is required');
  const ctx = 'monster_pack "' + pack.id + '"';
  if (typeof pack.name !== 'string' || !pack.name) throw new Error(ctx + ': name is required');
  if (pack.i18n !== undefined) validateI18n(pack.i18n, ctx, DUNGEON_LOCALES);
  if (!Array.isArray(pack.members) || pack.members.length === 0) {
    throw new Error(ctx + ': members must be a non-empty array');
  }
  // occupied cell -> the member that claimed it, so an overlap error can name
  // BOTH sides of the collision instead of just reporting that one exists.
  const claimed = new Map();
  pack.members.forEach(function (m, i) {
    const mctx = ctx + ' members[' + i + ']';
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error(mctx + ': must be an object');
    if (typeof m.enemy !== 'string' || !m.enemy) throw new Error(mctx + ': enemy (monster id) is required');
    const anchor = parseA1(m.at);
    if (!anchor) throw new Error(mctx + ' ("' + m.enemy + '"): at must be an A1 cell token like "F5", got ' + JSON.stringify(m.at));
    let footprint = [1, 1];
    if (enemyDefs) {
      const def = enemyDefs[m.enemy];
      if (!def) throw new Error(mctx + ': names monster "' + m.enemy + '", which has no live def');
      if (def.footprint !== undefined) footprint = def.footprint;
    } else if (m.footprint !== undefined) {
      footprint = m.footprint;
    }
    const cells = cellsFor(anchor, footprint);
    for (const cell of cells) {
      const r = cell[0], c = cell[1];
      if (r < PLACEABLE.rowMin || r > PLACEABLE.rowMax || c < PLACEABLE.colMin || c > PLACEABLE.colMax) {
        throw new Error(mctx + ' ("' + m.enemy + '" at ' + m.at + ', footprint '
          + footprint[0] + 'x' + footprint[1] + '): occupies ' + formatA1(r, c)
          + ', outside the placeable area '
          + formatA1(PLACEABLE.rowMin, PLACEABLE.colMin) + ':' + formatA1(PLACEABLE.rowMax, PLACEABLE.colMax)
          + ' (the field is ' + FIELD_COLS + 'x' + FIELD_ROWS + ' with a margin of 1)');
      }
      const key = r + ',' + c;
      const prev = claimed.get(key);
      if (prev !== undefined) {
        throw new Error(mctx + ' ("' + m.enemy + '" at ' + m.at + ') overlaps members[' + prev.i
          + '] ("' + prev.enemy + '" at ' + prev.at + ') on cell ' + formatA1(r, c));
      }
      claimed.set(key, { i: i, enemy: m.enemy, at: m.at });
    }
  });
  if (pack.note !== undefined && typeof pack.note !== 'string') throw new Error(ctx + ': note must be a string');
}


module.exports = {
  SUPPORTED_LOCALES, ITEM_ALLOWED_KEYS, SI_ALLOWED_KEYS, UNIT_ALLOWED_KEYS,
  validateUnitEntry, validatePackEntry,
  // REQ-0184: monster_pack/1 layout -- the ONE definition, shared by the machine check and the sim.
  validateMonsterPackEntry, parseA1, formatA1, cellsFor, PLACEABLE, FIELD_COLS, FIELD_ROWS,
  DUNGEON_LOCALES,
  isFiniteNum, isValidRange, validateEffect, validateI18n, validateSocket, validateBody,
};
