'use strict';
// sim/lib/heap.cjs -- REQ-0047 (d): the (t,seq)-tie-broken event heap (S1 resolution model).
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).


class EventHeap {
  constructor() { this.a = []; this._seq = 0; }
  size() { return this.a.length; }
  nextSeq() { return this._seq++; }
  _less(i, j) {
    const A = this.a[i], B = this.a[j];
    if (A.t !== B.t) return A.t < B.t;
    return A.seq < B.seq;
  }
  push(ev) {
    const a = this.a;
    a.push(ev);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._less(i, p)) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break;
    }
  }
  popMin() {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let s = i;
        if (l < a.length && this._less(l, s)) s = l;
        if (r < a.length && this._less(r, s)) s = r;
        if (s === i) break;
        [a[i], a[s]] = [a[s], a[i]];
        i = s;
      }
    }
    return top;
  }
}

// =====================================================================
// Diagonal direction vectors (S2.2/S3): (drow,dcol) terms.
// down-right=(+1,+1)  down-left=(+1,-1)  up-right=(-1,+1)  up-left=(-1,-1)
// =====================================================================

module.exports = {
  EventHeap,
};
