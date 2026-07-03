#!/usr/bin/env node
// tool_integrate.cjs — S3 dynamic integration check for backpack_ragnarok batches.
// Usage: node tool_integrate.cjs <vocab> <items> <accs> <approved_batch.json>
// For each batch PO: build a synthetic 1-BP-covers-6x6 state via the engine and
// exercise placement/rotation/socket behavior. For batch ACCs: probe socket matching.
'use strict';
const fs = require('fs');
const path = require('path');
const Engine = require('./v05_engine.js');

function loadJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function main() {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.error('Usage: node tool_integrate.cjs <vocab> <items> <accs> <approved_batch.json>');
    process.exit(1);
  }
  const [vocabPath, itemsPath, accsPath, batchPath] = args;
  const vocab = loadJSON(vocabPath);
  const liveItems = loadJSON(itemsPath);
  const liveAccs = loadJSON(accsPath);
  const batch = loadJSON(batchPath);

  const batchItems = batch.items || [];
  const batchAccs = batch.accs || [];

  const liveItemEntries = liveItems.entries || [];
  const liveAccEntries = liveAccs.entries || [];

  // Merge ITEMS/ACC_DEFS maps: live + batch (batch entries override/extend for probing).
  const ITEMS = {};
  for (const e of liveItemEntries) ITEMS[e.id] = toItemDef(e);
  for (const e of batchItems) ITEMS[e.id] = toItemDef(e);

  const ACC_DEFS = {};
  for (const e of liveAccEntries) ACC_DEFS[e.id] = toAccDef(e);
  for (const e of batchAccs) ACC_DEFS[e.id] = toAccDef(e);

  // Add synthetic probe accessories: one per socketType x tag-combo we need to test.
  // probe_<type>_notag: slot=type, reqTags=[]
  // probe_<type>_needs_<tag>: slot=type, reqTags=[tag]
  const socketTypes = vocab.socketTypes || ['gem', 'edge', 'coat', 'bond'];
  const socketTags = vocab.socketTags || ['Metal', 'Bone'];
  for (const st of socketTypes) {
    ACC_DEFS['__probe_' + st + '_open'] = { name: 'Probe(' + st + ',open)', slot: st, reqTags: [], icon: 'icon-probe', rarity: 'Common', eff: '' };
    for (const tg of socketTags) {
      ACC_DEFS['__probe_' + st + '_need_' + tg] = { name: 'Probe(' + st + ',' + tg + ')', slot: st, reqTags: [tg], icon: 'icon-probe', rarity: 'Common', eff: '' };
    }
  }
  // mismatched-type probe generator: for a socket of type T, a probe with slot != T
  function mismatchTypeFor(t) {
    const other = socketTypes.find(s => s !== t) || (t === 'gem' ? 'edge' : 'gem');
    return '__probe_' + other + '_open';
  }

  function toItemDef(e) {
    return { name: e.name, type: e.type, el: e.el, rarity: e.rarity, shape: e.shape, icon: e.icon, sockets: e.sockets || [], stretch: e.stretch, eff: '' };
  }
  function toAccDef(e) {
    return { name: e.name, slot: e.slot, reqTags: e.reqTags || [], icon: e.icon, rarity: e.rarity, eff: '' };
  }

  const LAYOUT = { ROWS: 6, COLS: 6 };
  // Synthetic BP: one 6x6 BP covering the whole canvas minus a linker cell at [1,1].
  function freshState() {
    return {
      linked: true,
      bps: [{
        id: 'synth', name: 'Synthetic BP', color: '#888888',
        shape: buildFullMinusLinker(),
        origin: [1, 1],
        linker: { off: [0, 0], dirs: [] },
      }],
      pos: [],
      accs: [],
    };
  }
  function buildFullMinusLinker() {
    // shape is relative to origin [1,1]; full 6x6 minus cell [0,0] (== canvas [1,1], the linker cell)
    const cells = [];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
      if (r === 0 && c === 0) continue; // linker offset [0,0] excluded
      cells.push([r, c]);
    }
    return cells;
  }

  const E = Engine.create(ITEMS, ACC_DEFS, LAYOUT);

  const report = [];
  let errorCount = 0;
  function fail(scope, msg) { report.push('  ERROR: ' + msg); errorCount++; return false; }
  function info(msg) { report.push('  ' + msg); }

  // ---------- PO checks ----------
  for (const e of batchItems) {
    report.push('PO ' + e.id + ' (' + e.name + ')');
    if (!ITEMS[e.id]) { fail(e.id, 'not found in merged ITEMS map'); continue; }

    // Fresh state, place at anchor [2,1] (inside open field, away from linker at [1,1]).
    let st = freshState();
    const uid = 'probe_po';
    st.pos.push({ uid, id: e.id, loc: 'grid', cell: [2, 1], rot: 0 });

    const chk = E.canPlacePO(st, uid, 0, [2, 1]);
    if (chk.ok) info('PASS placeable at [2,1]'); else fail(e.id, 'not placeable at [2,1]: ' + chk.why);

    // All 4 rotations legal in open field (test each independently from a fresh open state,
    // anchored so shape stays in-bounds — use canPlacePO which checks bounds itself first;
    // if it fails due to bounds near edge, retry from a safer anchor).
    for (let rot = 0; rot < 4; rot++) {
      const st2 = freshState();
      const uid2 = 'probe_rot';
      // try a few anchors to avoid false negatives from going out of canvas bounds
      const anchors = [[2, 2], [1, 2], [2, 1], [1, 1]];
      let rotOk = false, lastWhy = '';
      for (const anchor of anchors) {
        st2.pos = [{ uid: uid2, id: e.id, loc: 'grid', cell: anchor, rot }];
        const c = E.canPlacePO(st2, uid2, rot, anchor);
        if (c.ok) { rotOk = true; break; }
        lastWhy = c.why;
      }
      if (rotOk) info('PASS rotation ' + rot + ' legal somewhere in open field');
      else fail(e.id, 'rotation ' + rot + ' not legal at any tested anchor: ' + lastWhy);
    }

    // Sockets: every socket seats a matching probe accessory; rejects type-mismatch probe;
    // rejects tag-requiring probe if socket lacks that tag.
    const sockets = e.sockets || [];
    if (sockets.length === 0) {
      info('no sockets to test');
    } else {
      st = freshState();
      st.pos = [{ uid, id: e.id, loc: 'grid', cell: [2, 1], rot: 0 }];
      st.accs = [];
      const engSockets = E.sockets(st).filter(s => s.host === uid);
      sockets.forEach((sdef, si) => {
        const sock = engSockets.find(s => s.si === si);
        if (!sock) { fail(e.id, 'engine did not report socket index ' + si); return; }

        // matching probe (open, no reqTags)
        const matchProbeId = '__probe_' + sdef.t + '_open';
        st.accs.push({ uid: 'probe_match_' + si, id: matchProbeId, host: 'inv' });
        const seatOk = E.seatAcc(st, 'probe_match_' + si, sock.skey);
        if (seatOk.ok) info('PASS socket[' + si + '] (' + sdef.t + ') seats matching probe');
        else fail(e.id, 'socket[' + si + '] (' + sdef.t + ') rejected a matching-type probe: ' + seatOk.why);
        if (seatOk.ok) E.stowAcc(st, 'probe_match_' + si);

        // type-mismatched probe should be rejected
        const mismatchId = mismatchTypeFor(sdef.t);
        st.accs.push({ uid: 'probe_mismatch_' + si, id: mismatchId, host: 'inv' });
        const seatBad = E.seatAcc(st, 'probe_mismatch_' + si, sock.skey);
        if (!seatBad.ok) info('PASS socket[' + si + '] rejects type-mismatched probe (' + seatBad.why + ')');
        else fail(e.id, 'socket[' + si + '] incorrectly accepted a type-mismatched probe (' + mismatchId + ')');

        // tag-requiring probe for an absent tag should be rejected
        const tags = sdef.tags || [];
        const missingTag = socketTags.find(t => !tags.includes(t));
        if (missingTag) {
          const tagProbeId = '__probe_' + sdef.t + '_need_' + missingTag;
          st.accs.push({ uid: 'probe_tag_' + si, id: tagProbeId, host: 'inv' });
          const seatTag = E.seatAcc(st, 'probe_tag_' + si, sock.skey);
          if (!seatTag.ok) info('PASS socket[' + si + '] rejects probe requiring absent tag ' + missingTag + ' (' + seatTag.why + ')');
          else fail(e.id, 'socket[' + si + '] incorrectly accepted a probe requiring absent tag ' + missingTag);
        } else {
          info('socket[' + si + '] has all vocab tags; no "absent tag" case to test');
        }
      });
    }

    // combos(state) doesn't throw
    try {
      const st3 = freshState();
      st3.pos = [{ uid, id: e.id, loc: 'grid', cell: [2, 1], rot: 0 }];
      E.combos(st3);
      info('PASS combos(state) did not throw');
    } catch (ex) {
      fail(e.id, 'combos(state) threw: ' + ex.message);
    }

    report.push('');
  }

  // ---------- ACC checks ----------
  for (const e of batchAccs) {
    report.push('ACC ' + e.id + ' (' + e.name + ')');
    if (!ACC_DEFS[e.id]) { fail(e.id, 'not found in merged ACC_DEFS map'); continue; }

    const st = freshState();
    // synthetic host PO with one socket matching this acc's slot, tagged with all vocab tags
    // so we can independently test the "correct slot, has tag" and "correct slot, missing tag" cases.
    const hostId = '__synthhost_' + e.slot;
    if (!ITEMS[hostId]) {
      ITEMS[hostId] = {
        name: 'Synthetic Host (' + e.slot + ')', type: 'Weapon', el: [], rarity: 'Common',
        shape: [[0, 0]], icon: 'icon-synthhost', sockets: [{ t: e.slot, tags: socketTags.slice(), ax: 0.5, ay: 0.5 }], eff: '',
      };
    }
    st.pos.push({ uid: 'synthhost', id: hostId, loc: 'grid', cell: [2, 1], rot: 0 });
    st.accs.push({ uid: 'probe_acc', id: e.id, host: 'inv' });

    const sock = E.sockets(st).find(s => s.host === 'synthhost');
    if (!sock) { fail(e.id, 'engine failed to report synthetic host socket'); report.push(''); continue; }

    const seat = E.seatAcc(st, 'probe_acc', sock.skey);
    const reqTags = e.reqTags || [];
    if (reqTags.length === 0 || reqTags.every(t => socketTags.includes(t))) {
      if (seat.ok) info('PASS seats into matching slot=' + e.slot + ' with all-tags host');
      else fail(e.id, 'failed to seat into a same-slot, all-tags host: ' + seat.why);
    }

    // Now test a host with the *other* slot type -> should be rejected on slot.
    const otherSlot = socketTypes.find(s => s !== e.slot) || 'gem';
    const otherHostId = '__synthhost_' + otherSlot;
    if (!ITEMS[otherHostId]) {
      ITEMS[otherHostId] = {
        name: 'Synthetic Host (' + otherSlot + ')', type: 'Weapon', el: [], rarity: 'Common',
        shape: [[0, 0]], icon: 'icon-synthhost', sockets: [{ t: otherSlot, tags: socketTags.slice(), ax: 0.5, ay: 0.5 }], eff: '',
      };
    }
    const st2 = freshState();
    st2.pos.push({ uid: 'synthhost2', id: otherHostId, loc: 'grid', cell: [2, 1], rot: 0 });
    st2.accs.push({ uid: 'probe_acc2', id: e.id, host: 'inv' });
    const sock2 = E.sockets(st2).find(s => s.host === 'synthhost2');
    const seat2 = E.seatAcc(st2, 'probe_acc2', sock2.skey);
    if (!seat2.ok) info('PASS rejects mismatched slot (' + otherSlot + '): ' + seat2.why);
    else fail(e.id, 'incorrectly seated into a mismatched-slot socket (' + otherSlot + ')');

    // If reqTags non-empty: host with NO tags on the socket should be rejected.
    if (reqTags.length) {
      const bareHostId = '__synthhost_bare_' + e.slot;
      if (!ITEMS[bareHostId]) {
        ITEMS[bareHostId] = {
          name: 'Synthetic Bare Host (' + e.slot + ')', type: 'Weapon', el: [], rarity: 'Common',
          shape: [[0, 0]], icon: 'icon-synthhost', sockets: [{ t: e.slot, tags: [], ax: 0.5, ay: 0.5 }], eff: '',
        };
      }
      const st3 = freshState();
      st3.pos.push({ uid: 'synthhost3', id: bareHostId, loc: 'grid', cell: [2, 1], rot: 0 });
      st3.accs.push({ uid: 'probe_acc3', id: e.id, host: 'inv' });
      const sock3 = E.sockets(st3).find(s => s.host === 'synthhost3');
      const seat3 = E.seatAcc(st3, 'probe_acc3', sock3.skey);
      if (!seat3.ok) info('PASS rejects same-slot host lacking required tags ' + JSON.stringify(reqTags) + ': ' + seat3.why);
      else fail(e.id, 'incorrectly seated into a same-slot host lacking required tags ' + JSON.stringify(reqTags));
    } else {
      info('reqTags empty: no missing-tag rejection case to test');
    }

    report.push('');
  }

  console.log('=== backpack_ragnarok integration check (S3) ===');
  console.log('batch: ' + path.basename(batchPath));
  console.log('');
  console.log(report.join('\n'));
  console.log('--- summary ---');
  console.log('PO entries checked: ' + batchItems.length);
  console.log('ACC entries checked: ' + batchAccs.length);
  console.log('errors: ' + errorCount);
  process.exit(errorCount > 0 ? 1 : 0);
}

main();
