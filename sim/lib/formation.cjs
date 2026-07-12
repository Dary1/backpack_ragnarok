'use strict';
// sim/lib/formation.cjs -- REQ-0047 (d): A1:Z18 box parser + the formation defs.
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).


function colLetterToIndex(ch) { return ch.toUpperCase().charCodeAt(0) - 64; } // A->1
function colIndexToLetter(idx) { return String.fromCharCode(64 + idx); }

function parseBox(boxStr) {
  const m = /^([A-Za-z])(\d+):([A-Za-z])(\d+)$/.exec(boxStr.trim());
  if (!m) throw new Error('parseBox: malformed box string "' + boxStr + '"');
  const c1 = colLetterToIndex(m[1]), r1 = parseInt(m[2], 10);
  const c2 = colLetterToIndex(m[3]), r2 = parseInt(m[4], 10);
  return {
    colMin: Math.min(c1, c2), colMax: Math.max(c1, c2),
    rowMin: Math.min(r1, r2), rowMax: Math.max(r1, r2),
  };
}

// =====================================================================
// Formation defs (S5.1/S5.2, verbatim boxes incl. the CORRECTED formation4).
// =====================================================================
const FORMATIONS = {
  formation1: {
    id: 'formation1', note: 'standard; 2 front cover 2 back (top-entry only)',
    canvases: { unit1: 'F2:M9', unit2: 'N2:U9', unit3: 'B10:I17', unit4: 'R10:Y17' },
  },
  formation2: {
    id: 'formation2', note: 'unit1 tank up top; unit4 well protected',
    canvases: { unit1: 'J2:Q9', unit2: 'B6:I13', unit3: 'R6:Y13', unit4: 'J10:Q17' },
  },
  formation3: {
    id: 'formation3', note: 'corner squads tank top diagonals',
    canvases: { unit1: 'B2:I9', unit2: 'R2:Y9', unit3: 'F10:M17', unit4: 'N10:U17' },
  },
  formation4: {
    id: 'formation4',
    note: 'CORRECTED per ratified fix: unit4=backline_center=J11:Q18 (8 rows, ' +
      'in-bounds) -- supersedes any xlsx/older-doc J11:Q19 (which overran row 18).',
    canvases: {
      unit1: 'B2:I9',   // left_wing
      unit2: 'J2:Q9',   // center_top
      unit3: 'R2:Y9',   // right_wing
      unit4: 'J11:Q18', // backline_center
    },
  },
};

// Sanity-check every formation box is exactly 8x8 (matches 8x8 squad canvas
// layout in scenario.json) at module load time -- fail fast on any typo.
(function validateFormationBoxes() {
  for (const fid of Object.keys(FORMATIONS)) {
    const cv = FORMATIONS[fid].canvases;
    for (const squad of Object.keys(cv)) {
      const box = parseBox(cv[squad]);
      const w = box.colMax - box.colMin + 1, h = box.rowMax - box.rowMin + 1;
      if (w !== 8 || h !== 8) {
        throw new Error('Formation box ' + fid + '.' + squad + ' (' + cv[squad] +
          ') is ' + w + 'x' + h + ', expected 8x8');
      }
    }
  }
})();

// =====================================================================
// Status system (S7) -- one damage cadence constant P, tiny interaction
// matrix (5 rules, kept exactly as tabulated).
// =====================================================================

module.exports = {
  colLetterToIndex,
  colIndexToLetter,
  parseBox,
  FORMATIONS,
};
