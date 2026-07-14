import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_CODE_ROOT, E2E_CLI_ENV } from "./e2e-env";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { GUEST_AUTH_TRACKED_FILES_PATH, PLAYERS_DIR, PROFILES_DIR } from "./global-setup";
import { loadFixtureAndBoot, waitForAutoSave } from "./helpers";

// REQ-0141 -- first-run canvas guidance E2E. Mints fresh guest players via the
// real operator CLI (same rig as starter-units.spec.ts) so the guided tour
// auto-activates (a genuinely fresh profile), then verifies the REQ gates: the
// guided sequence completes; the skip path leaves a fully usable starter
// canvas; progress + completion persist across a reload (via the ONE auto-save
// PUT writer); and the tour is replayable from Settings.

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
  trackFileForCleanup(join(PLAYERS_DIR, playerId + ".json"), "first-run-guide guest registry (" + name + ")");
  trackFileForCleanup(join(PROFILES_DIR, playerId + ".json"), "first-run-guide guest profile (" + name + ")");
  return { playerId, token, name };
}

async function bootGuest(page: Page, token: string): Promise<void> {
  await page.goto("/app/#/invite/" + token);
  await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
  await page.waitForSelector(".data-source-badge", { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector(".data-source-badge")?.textContent?.trim() === "live", { timeout: 10000 });
  await page.waitForTimeout(500);
}

async function reboot(page: Page): Promise<void> {
  await page.reload();
  await page.waitForSelector(".data-source-badge", { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector(".data-source-badge")?.textContent?.trim() === "live", { timeout: 10000 });
  await page.waitForTimeout(400);
}

async function getGuestCanvas(page: Page, p: CreatedPlayer): Promise<any> {
  const resp = await page.request.get("/api/profile/" + p.playerId + "/canvas", { headers: { "X-Auth-Token": p.token } });
  if (resp.status() !== 200) return null;
  return (await resp.json()).canvas;
}

test.describe("REQ-0141 first-run canvas guidance", () => {
  test("1. a fresh guest sees the guided tour auto-activated on the first card", async ({ page }) => {
    const g = createGuestPlayer("E2E Guide Fresh");
    await bootGuest(page, g.token);
    const guide = page.locator(".first-run-guide");
    await expect(guide).toBeVisible();
    await expect(guide).toHaveAttribute("data-guide-status", "active");
    await expect(guide).toHaveAttribute("data-guide-step-id", "bp");
    await expect(page.locator(".squad-tab")).toHaveCount(5);
  });

  test("2. clicking through every card completes the sequence; completion persists across a reload", async ({ page }) => {
    const g = createGuestPlayer("E2E Guide Complete");
    await bootGuest(page, g.token);
    const guide = page.locator(".first-run-guide");
    await expect(guide).toHaveAttribute("data-guide-step-id", "bp");
    for (const id of ["po", "unit", "links", "depart"]) {
      await page.getByTestId("guide-next").click();
      await expect(guide).toHaveAttribute("data-guide-step-id", id);
    }
    await page.getByTestId("guide-next").click();
    await expect(page.locator(".first-run-guide")).toHaveCount(0);
    await expect(page.locator(".squad-tab")).toHaveCount(5);
    await waitForAutoSave(page);
    await reboot(page);
    await expect(page.locator(".first-run-guide")).toHaveCount(0);
  });

  test("3. skip leaves a fully usable canvas, and the skip persists across a reload", async ({ page }) => {
    const g = createGuestPlayer("E2E Guide Skip");
    await bootGuest(page, g.token);
    await expect(page.locator(".first-run-guide")).toBeVisible();
    await page.getByTestId("guide-skip").click();
    await expect(page.locator(".first-run-guide")).toHaveCount(0);
    const tabs = page.locator(".squad-tab");
    await expect(tabs).toHaveCount(5);
    await tabs.nth(1).click();
    await waitForAutoSave(page);
    const canvas = await getGuestCanvas(page, g);
    expect(canvas).toBeTruthy();
    expect(canvas.presets.active).toBe(1);
    await reboot(page);
    await expect(page.locator(".first-run-guide")).toHaveCount(0);
  });

  test("4. mid-tour progress persists across a reload", async ({ page }) => {
    const g = createGuestPlayer("E2E Guide Persist");
    await bootGuest(page, g.token);
    const guide = page.locator(".first-run-guide");
    await expect(guide).toHaveAttribute("data-guide-step-id", "bp");
    await page.getByTestId("guide-next").click();
    await page.getByTestId("guide-next").click();
    await expect(guide).toHaveAttribute("data-guide-step-id", "unit");
    await waitForAutoSave(page);
    await reboot(page);
    const after = page.locator(".first-run-guide");
    await expect(after).toHaveAttribute("data-guide-status", "active");
    await expect(after).toHaveAttribute("data-guide-step-id", "unit");
  });

  test("5. the guide is replayable from Settings", async ({ page }) => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/baseline-smoke-fixture.json", import.meta.url), "utf8"));
    await loadFixtureAndBoot(page, fixture);
    await expect(page.locator(".first-run-guide")).toHaveCount(0);
    await page.locator(".nav-link", { hasText: "Settings" }).click();
    await expect(page.getByTestId("settings-guide")).toBeVisible();
    await page.getByTestId("settings-guide-replay").click();
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    const guide = page.locator(".first-run-guide");
    await expect(guide).toBeVisible();
    await expect(guide).toHaveAttribute("data-guide-status", "active");
    await expect(guide).toHaveAttribute("data-guide-step-id", "bp");
  });
});
