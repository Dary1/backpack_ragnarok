import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_CODE_ROOT, E2E_CLI_ENV } from "./e2e-env";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { GUEST_AUTH_TRACKED_FILES_PATH, PLAYERS_DIR, PROFILES_DIR } from "./global-setup";
import { cx, cy, drag, waitForAutoSave } from "./helpers";

// REQ-0051 -- starter units E2E. Mints fresh guest players via the real
// operator CLI (same rig as guest-auth.spec.ts), then verifies: (1) a fresh
// profile is seeded with the four starter-unit squads; (2) a fixed starter PO
// cannot be dragged off its seeded cell; (3) a starter unit squad can be
// discarded via the squad trash drop. The starter content is served by the
// e2e backend via the tools/e2e_fleet.cjs overlay (this worktree only).

const CLI_INVITE_PATH = join(E2E_CODE_ROOT, "server", "cli_invite.cjs");

interface CreatedPlayer { playerId: string; token: string; name: string; }

function trackFileForCleanup(filePath: string, label: string): void {
  const existing: Array<{ path: string; label: string }> = existsSync(GUEST_AUTH_TRACKED_FILES_PATH)
    ? JSON.parse(readFileSync(GUEST_AUTH_TRACKED_FILES_PATH, "utf8"))
    : [];
  existing.push({ path: filePath, label });
  writeFileSync(GUEST_AUTH_TRACKED_FILES_PATH, JSON.stringify(existing, null, 1) + "\n");
}

function createGuestPlayer(name: string): CreatedPlayer {
  const output = execFileSync(process.execPath, [CLI_INVITE_PATH, name], { cwd: E2E_CODE_ROOT, env: E2E_CLI_ENV, encoding: "utf8" });
  const playerIdMatch = /playerId:\s*(\S+)/.exec(output);
  const tokenMatch = /#\/invite\/(\S+)/.exec(output);
  if (!playerIdMatch || !tokenMatch) throw new Error("cli_invite output did not match expected shape:\n" + output);
  const playerId = playerIdMatch[1];
  const token = tokenMatch[1];
  trackFileForCleanup(join(PLAYERS_DIR, playerId + ".json"), "starter-units guest registry (" + name + ")");
  trackFileForCleanup(join(PROFILES_DIR, playerId + ".json"), "starter-units guest profile (" + name + ")");
  return { playerId, token, name };
}

async function bootGuest(page: Page, token: string): Promise<void> {
  await page.goto("/app/#/invite/" + token);
  await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
  await page.waitForSelector(".data-source-badge", { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector(".data-source-badge")?.textContent?.trim() === "live", { timeout: 10000 });
  await page.waitForTimeout(500);
}

async function getGuestCanvas(page: Page, p: CreatedPlayer): Promise<any> {
  const resp = await page.request.get("/api/profile/" + p.playerId + "/canvas", { headers: { "X-Auth-Token": p.token } });
  if (resp.status() !== 200) return null;
  return (await resp.json()).canvas;
}

test.describe("REQ-0051 starter units", () => {
  test("1. a fresh guest profile is seeded with the four starter-unit squads", async ({ page }) => {
    const g = createGuestPlayer("E2E Starter Fresh");
    await bootGuest(page, g.token);
    const tabs = page.locator(".squad-tab");
    await expect(tabs).toHaveCount(5); // four starter units + one empty spare
    await expect(tabs.nth(0)).toHaveText("Starter: Guard");
    await expect(tabs.nth(1)).toHaveText("Starter: Arms");
    await expect(tabs.nth(2)).toHaveText("Starter: Mend");
    await expect(tabs.nth(3)).toHaveText("Starter: Scout");
  });

  test("2. a fixed starter PO cannot be moved off its seeded cell", async ({ page }) => {
    const g = createGuestPlayer("E2E Starter Fixed");
    await bootGuest(page, g.token);
    // Guard squad is active. tower_shield is a fixed PO seeded at cell [2,3].
    const boardBox = (await page.locator("canvas.board-canvas").first().boundingBox())!;
    // Try to drag the fixed PO from [2,3] to a free cell [6,5]. The board
    // guard + engine both refuse -- it must never lift or move.
    await drag(page, { x: boardBox.x + cx(3), y: boardBox.y + cy(2) }, { x: boardBox.x + cx(5), y: boardBox.y + cy(6) });
    // Force a save WITHOUT touching the fixed PO: switch squads and back.
    await page.locator(".squad-tab").nth(1).click();
    await page.waitForTimeout(250);
    await page.locator(".squad-tab").nth(0).click();
    await waitForAutoSave(page);
    const canvas = await getGuestCanvas(page, g);
    expect(canvas).toBeTruthy();
    const ts = canvas.pos.find((pp: any) => pp.id === "tower_shield");
    expect(ts).toBeTruthy();
    expect(ts.fixed).toBe(true);
    expect(ts.cell).toEqual([2, 3]); // unchanged -- the pinned PO never moved
  });

  test("3. a starter unit squad can be discarded via the squad trash drop", async ({ page }) => {
    const g = createGuestPlayer("E2E Starter Discard");
    await bootGuest(page, g.token);
    const tabs = page.locator(".squad-tab");
    await expect(tabs).toHaveCount(5);
    // Drag the Guard tab (index 0) onto the canvas board center = the trash zone.
    const box = (await tabs.nth(0).boundingBox())!;
    const boardBox = (await page.locator("canvas.board-canvas").first().boundingBox())!;
    const gx = box.x + box.width / 2, gy = box.y + box.height / 2;
    const dropX = boardBox.x + boardBox.width / 2, dropY = boardBox.y + boardBox.height / 2;
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { const t = i / 8; await page.mouse.move(gx + (dropX - gx) * t, gy + (dropY - gy) * t, { steps: 1 }); await page.waitForTimeout(25); }
    await page.waitForTimeout(150);
    await page.mouse.up();
    await page.waitForTimeout(400);
    await expect(tabs).toHaveCount(4); // Guard discarded
    await expect(page.locator(".squad-tab", { hasText: "Starter: Guard" })).toHaveCount(0);
  });
});
