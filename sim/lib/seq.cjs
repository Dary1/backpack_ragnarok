'use strict';
// sim/lib/seq.cjs -- REQ-0256. The replay log's monotone emission counter.
// This is EventHeap's _seq, extracted: the heap retired (REQ-0256) but `seq`
// is a WIRE FIELD (shared/dto.ts ApiRunEvent.seq) that every replay consumer
// reads, so the counter outlives the queue that used to own it. It no longer
// ORDERS anything -- ordering is the tick loop's (REQ-0256 s10) -- it only
// stamps emission order onto the log.
class SeqCounter {
  constructor() { this._seq = 0; }
  nextSeq() { return this._seq++; }
}

module.exports = { SeqCounter };
