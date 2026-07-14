// REQ-0142 -- link-trace diagnostics: hovering a Unit core (or one beam
// segment) on the canvas board floats the trace panel (.beam-trace,
// BeamTracePanel.tsx), which says what each of the eight beams LINKS -- or
// WHY the link the player expected is absent.
//
// The REQ's gate, verbatim: "hover trace + all three 'why not' reasons render
// on canonical layouts (mutual link, dud, blocked chain)". This file IS those
// canonical layouts, in ONE fixture, because they interlock -- the same three
// Units produce all three reasons at once, which is exactly the situation a
// player is in when they need the panel:
//
//        col 2        col 4                col 7
//   row 4  [WEST] --E--> [MID] <--W-- ... [EAST]
//            ^  <---W----   |                |
//            |              |  MID fires ONLY west, so its EAST direction --
//            |              |  aimed straight at EAST -- is never fired.
//            |              |          => 'dir-not-in-set'
//            |
//            |  WEST also fires NORTH, at empty space. => 'no-receiver' (dud)
//            |
//            EAST's westward beam reaches MID FIRST and dies there, so WEST --
//            further along the same ray -- never hears it. => 'blocked'
//
//   WEST <-> MID each target the other  => MUTUAL link badge.
//
// (Cells are [row, col], 1-based, as everywhere in the engine. The BPs are 1x1
// so a BP's only cell IS its Unit cell: the beam graph is a pure function of
// Unit cells + dirs, so this keeps the fixture readable without changing a
// thing about what is under test.)
import { test, expect } from '@playwright/test';
import { bootApp, cx, cy, drag } from './helpers';

const bp = (id: string, name: string, cell: [number, number], dirs: number[]) => ({
  id,
  name,
  color: '#4a90d9',
  shape: [[0, 0]],
  origin: cell,
  linker: { off: [0, 0], dirs },
});

function makeCanvas() {
  return {
    linked: false,
    bps: [
      bp('west', 'West Pack', [4, 2], [0, 2]), // fires N (dud) + E (-> MID)
      bp('mid', 'Mid Pack', [4, 4], [6]), // fires W only (-> WEST): mutual with WEST
      bp('east', 'East Pack', [4, 7], [6]), // fires W: hits MID first; WEST is shadowed
    ],
    pos: [],
    sis: [],
    layout: { ROWS: 8, COLS: 8 },
    presets: { active: 0, names: ['P1'], store: [null] },
    inv: {
      pages: [
        { bps: [], pos: [], sis: [], tms: [] },
        { bps: [], pos: [], sis: [], tms: [] },
        { bps: [], pos: [], sis: [], tms: [] },
        { bps: [], pos: [], sis: [], tms: [] },
        { bps: [], pos: [], sis: [], tms: [] },
      ],
      names: ['1', '2', '3', '4', '5'],
    },
  };
}

/** Move the pointer onto a board cell centre and let the hover publish +
 * repaint settle. Hover is a pub-sub -> board repaint -> React render chain
 * (board/beamHover.ts), all synchronous, but Playwright still needs one tick
 * to see the DOM. */
async function hoverCell(page: import('@playwright/test').Page, box: { x: number; y: number }, row: number, col: number) {
  await page.mouse.move(box.x + cx(col), box.y + cy(row));
  await page.waitForTimeout(120);
}

test.describe('REQ-0142 -- link-trace diagnostics', () => {
  test('hovering a Unit traces its whole fan: linked + MUTUAL badge + DUD', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    await expect(page.locator('.beam-trace')).toHaveCount(0);

    // --- MID: the clean, unshadowed link. Its westward ray hits WEST and there
    // is nothing behind WEST, so this row is a pure 'linked' -- and MUTUAL,
    // since WEST fires straight back east into MID.
    await hoverCell(page, box, 4, 4);
    const panel = page.locator('.beam-trace');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-beam-bp', 'mid');
    await expect(panel).toHaveAttribute('data-beam-dir', 'all'); // the core = the whole 8-dir fan
    await expect(panel.locator('.beam-trace-row')).toHaveCount(8);

    const midWest = panel.locator('.beam-trace-row[data-dir="6"]');
    await expect(midWest).toHaveAttribute('data-status', 'linked');
    await expect(midWest).toHaveAttribute('data-reason', 'linked');
    await expect(midWest).toContainText('West Pack');
    await expect(midWest.locator('.beam-trace-mutual')).toBeVisible(); // mutual-link badge
    await expect(panel.locator('.beam-trace-summary')).toHaveText('1 linked · 1 mutual · 0 dud');

    // --- WEST: the same mutual link read from the other end, plus a DUD.
    await hoverCell(page, box, 4, 2);
    await expect(panel).toHaveAttribute('data-beam-bp', 'west');

    // dir 0 (N) -> empty space. A dud is legitimate design: MARK it, never nag.
    const north = panel.locator('.beam-trace-row[data-dir="0"]');
    await expect(north).toHaveAttribute('data-status', 'dud');
    await expect(north).toHaveAttribute('data-reason', 'no-receiver'); // why-not reason: no receiver
    await expect(north).toContainText('No Unit stands on this ray');

    // dir 2 (E) -> MID: linked, mutual. It ALSO shadows EAST (which sits behind
    // MID on the very same ray), and the panel says so rather than quietly
    // rounding it off to a plain link -- shadowing is symmetric in a collinear
    // chain, and pretending otherwise would be the first lie in a tool whose
    // whole job is to be believed.
    const east = panel.locator('.beam-trace-row[data-dir="2"]');
    await expect(east).toHaveAttribute('data-status', 'linked');
    await expect(east).toHaveAttribute('data-reason', 'blocked');
    await expect(east).toContainText('Mid Pack');
    await expect(east.locator('.beam-trace-mutual')).toBeVisible();

    // Summary counts the fan honestly: 1 link, 1 mutual, 1 dud.
    await expect(panel.locator('.beam-trace-summary')).toHaveText('1 linked · 1 mutual · 1 dud');
  });

  test('why-not: BLOCKED -- the first-hit rule consumed the beam', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    await hoverCell(page, box, 4, 7); // EAST's Unit core

    const row = page.locator('.beam-trace .beam-trace-row[data-dir="6"]'); // W
    await expect(row).toHaveAttribute('data-reason', 'blocked'); // why-not #2
    await expect(row).toHaveAttribute('data-status', 'linked'); // it DID link -- just not to WEST
    await expect(row).toContainText('West Pack'); // the link that is NOT happening
    await expect(row).toContainText('Mid Pack'); // ...and who took the first hit
    await expect(row).toContainText('D4'); // ...and where (canvas_spec's own cell notation)
  });

  test('why-not: DIRECTION NOT IN THE UNIT\'S SET -- aligned, but no beam is fired', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    await hoverCell(page, box, 4, 4); // MID's Unit core

    // MID and EAST are dead in line, three cells apart, and there is no link:
    // MID simply does not fire east. That is the answer, and it is the answer
    // no amount of staring at the board gives you.
    const row = page.locator('.beam-trace .beam-trace-row[data-dir="2"]'); // E
    await expect(row).toHaveAttribute('data-status', 'inactive');
    await expect(row).toHaveAttribute('data-reason', 'dir-not-in-set'); // why-not #3
    await expect(row).toContainText('not in the Unit\'s set');
    await expect(row).toContainText('East Pack'); // who WOULD receive it
    await expect(row).toContainText('G4');
  });

  test('hovering a BEAM SEGMENT narrows the panel to that one direction', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // (4,6) sits on EAST's westward beam and on no Unit core -- the beam
    // segment, not the Unit, is the subject.
    await hoverCell(page, box, 4, 6);

    const panel = page.locator('.beam-trace');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-beam-bp', 'east');
    await expect(panel).toHaveAttribute('data-beam-dir', '6');
    await expect(panel.locator('.beam-trace-row')).toHaveCount(1);
    await expect(panel.locator('.beam-trace-row')).toHaveAttribute('data-reason', 'blocked');
  });

  test('the trace clears when the pointer leaves the Unit/beam', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    await hoverCell(page, box, 4, 2);
    await expect(page.locator('.beam-trace')).toBeVisible();

    await hoverCell(page, box, 8, 8); // empty corner, no Unit, no beam
    await expect(page.locator('.beam-trace')).toHaveCount(0);
  });

  test('a DRAG in flight suppresses the trace (interrogation is not editing)', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    // Dragging WEST's BP by its Unit core: the pointer starts ON a Unit (which
    // would hover) but the moment the carry arms, the panel must get out of the
    // way -- exactly like the item tip does.
    await drag(page, { x: box.x + cx(2), y: box.y + cy(4) }, { x: box.x + cx(2), y: box.y + cy(7) });
    await expect(page.locator('.beam-trace')).toHaveCount(0);
  });

  test('the diagnostics are localized (ja)', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    await page.locator('.lang-toggle').click();
    const box = (await page.locator('canvas.board-canvas').first().boundingBox())!;

    await hoverCell(page, box, 4, 7); // EAST -- the blocked chain
    const panel = page.locator('.beam-trace');
    await expect(panel.locator('.beam-trace-title')).toHaveText('ビーム診断');
    await expect(panel.locator('.beam-trace-row[data-dir="6"]')).toContainText('最初の命中');
  });

  test('the inventory board never traces (Unit dormancy: no beams there)', async ({ page }) => {
    await page.request.put('/api/profile/default/canvas', { data: makeCanvas() });
    await bootApp(page);
    const inv = (await page.locator('canvas.inventory-board-canvas').boundingBox())!;

    await page.mouse.move(inv.x + cx(2), inv.y + cy(2));
    await page.waitForTimeout(120);
    await expect(page.locator('.beam-trace')).toHaveCount(0);
  });
});
