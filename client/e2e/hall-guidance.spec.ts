import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_CODE_ROOT, E2E_CLI_ENV } from "./e2e-env";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { GUEST_AUTH_TRACKED_FILES_PATH, PLAYERS_DIR, PROFILES_DIR } from "./global-setup";
import { bootApp, fetchSavedCanvas, loadFixtureAndBoot, waitForAutoSave } from "./helpers";

// REQ-0376 -- onboarding beyond the canvas. Three gates:
//   1. FRESH PROFILE, per hall: the first visit to each of the five halls shows
//      that hall's card; dismissing one dismisses only that one; a dismiss
//      survives a reload, forever.
//   2. RETURNING PROFILE (the REQ-0141 guarantee, re-asserted): a profile with
//      NO state.guide can walk every hall and its saved canvas comes back
//      BYTE-IDENTICAL. Only a deliberate dismiss creates the field, and it
//      writes exactly one flag -- with status 'done'/seen:false, so the canvas
//      tour and the contextual-hint cohort gate are not retroactively opened.
//   3. The Dex "Terms" tab renders complete in en AND ja, and the pre-existing
//      dex tabs/selectors are untouched.
//
// The fresh-guest rig (cli_invite -> real invite boot) is first-run-guide.spec
// .ts's, verbatim in shape: a genuinely fresh profile is the only way to get a
// state.guide that boot itself seeded.

const CLI_INVITE_PATH = join(E2E_CODE_ROOT, "server", "cli_invite.cjs");
interface CreatedPlayer { playerId: string; token: string; name: string; }

/** The halls in nav order, with the hash route each is reached by. Mirrors
 * HALL_IDS in client/src/guide/guideModel.ts -- if one is added there without
 * being added here, test 1 stops covering it, so keep them in step. */
const HALLS = ["schedule", "sortie", "warehouse", "workshop", "market"] as const;
type Hall = (typeof HALLS)[number];

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
  trackFileForCleanup(join(PLAYERS_DIR, playerId + ".json"), "hall-guidance guest registry (" + name + ")");
  trackFileForCleanup(join(PROFILES_DIR, playerId + ".json"), "hall-guidance guest profile (" + name + ")");
  return { playerId, token, name };
}

async function bootGuest(page: Page, token: string): Promise<void> {
  await page.goto("/app/#/invite/" + token);
  await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector(".data-source-badge")?.textContent?.trim() === "live", { timeout: 10000 });
}

async function gotoHall(page: Page, hall: Hall): Promise<void> {
  await page.evaluate((h) => { window.location.hash = "#/" + h; }, hall);
  await expect(page).toHaveURL(new RegExp("#/" + hall + "$"), { timeout: 10000 });
}

async function guestCanvas(page: Page, p: CreatedPlayer): Promise<any> {
  const resp = await page.request.get("/api/profile/" + p.playerId + "/canvas", { headers: { "X-Auth-Token": p.token } });
  if (resp.status() !== 200) return null;
  return (await resp.json()).canvas;
}

test.describe("REQ-0376 hall cards", () => {
  test("1. a fresh profile sees every hall's card on its first visit", async ({ page }) => {
    const g = createGuestPlayer("E2E Hall All");
    await bootGuest(page, g.token);
    for (const hall of HALLS) {
      await gotoHall(page, hall);
      await expect(page.getByTestId("hall-card-" + hall)).toBeVisible();
      // The laws are stated, not just the title -- an empty card would be a
      // silent i18n miss (t() falls back to echoing the key, never throws).
      const laws = page.locator(`[data-hall-card="${hall}"] .hall-card-law`);
      expect(await laws.count()).toBeGreaterThanOrEqual(3);
      await expect(laws.first()).not.toBeEmpty();
    }
  });

  test("2. dismissing one hall dismisses ONLY that hall, and it never returns", async ({ page }) => {
    const g = createGuestPlayer("E2E Hall One");
    await bootGuest(page, g.token);
    await gotoHall(page, "warehouse");
    await page.getByTestId("hall-card-dismiss-warehouse").click();
    await expect(page.getByTestId("hall-card-warehouse")).toHaveCount(0);
    // Independence: the other four are untouched by that dismiss.
    for (const hall of HALLS.filter((h) => h !== "warehouse")) {
      await gotoHall(page, hall);
      await expect(page.getByTestId("hall-card-" + hall)).toBeVisible();
    }
    await waitForAutoSave(page);
    const canvas = await guestCanvas(page, g);
    expect(canvas.guide.halls).toEqual({ warehouse: true });

    // ... and it survives a reload, which is the whole point of persisting it.
    await page.reload();
    await page.waitForFunction(() => document.querySelector(".data-source-badge")?.textContent?.trim() === "live", { timeout: 10000 });
    await gotoHall(page, "warehouse");
    await expect(page.getByTestId("hall-card-warehouse")).toHaveCount(0);
    await gotoHall(page, "market");
    await expect(page.getByTestId("hall-card-market")).toBeVisible();
  });

  test("3. dismissing every hall leaves none of them, across a reload", async ({ page }) => {
    const g = createGuestPlayer("E2E Hall Sweep");
    await bootGuest(page, g.token);
    for (const hall of HALLS) {
      await gotoHall(page, hall);
      await page.getByTestId("hall-card-dismiss-" + hall).click();
      await expect(page.getByTestId("hall-card-" + hall)).toHaveCount(0);
    }
    await waitForAutoSave(page);
    await page.reload();
    await page.waitForFunction(() => document.querySelector(".data-source-badge")?.textContent?.trim() === "live", { timeout: 10000 });
    for (const hall of HALLS) {
      await gotoHall(page, hall);
      await expect(page.getByTestId("hall-card-" + hall)).toHaveCount(0);
    }
  });

  test("4. REQ-0141 guarantee: a guide-less profile walks every hall and its save is byte-unchanged", async ({ page }) => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/baseline-smoke-fixture.json", import.meta.url), "utf8"));
    await loadFixtureAndBoot(page, fixture);
    const before = await fetchSavedCanvas(page);
    expect(before.guide).toBeUndefined();

    for (const hall of HALLS) {
      await gotoHall(page, hall);
      // A veteran DOES see the cards -- the laws are new to them too. What
      // must not happen is a write.
      await expect(page.getByTestId("hall-card-" + hall)).toBeVisible();
    }
    await waitForAutoSave(page);
    const after = await fetchSavedCanvas(page);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(after.guide).toBeUndefined();

    // The dismiss is the ONE writer, and it writes exactly one flag onto a
    // record that leaves the canvas tour closed ('done') and the contextual-
    // hint cohort gate shut (seen:false).
    await gotoHall(page, "market");
    await page.getByTestId("hall-card-dismiss-market").click();
    await waitForAutoSave(page);
    const written = await fetchSavedCanvas(page);
    expect(written.guide.halls).toEqual({ market: true });
    expect(written.guide.status).toBe("done");
    expect(written.guide.seen).toBe(false);
  });

  test("5. Settings 'Replay all guidance' clears the hall flags too", async ({ page }) => {
    const g = createGuestPlayer("E2E Hall Replay");
    await bootGuest(page, g.token);
    await gotoHall(page, "workshop");
    await page.getByTestId("hall-card-dismiss-workshop").click();
    await expect(page.getByTestId("hall-card-workshop")).toHaveCount(0);

    await page.evaluate(() => { window.location.hash = "#/settings"; });
    await expect(page.getByTestId("settings-guide")).toBeVisible();
    await page.getByTestId("settings-guide-replay").click();
    await expect(page).toHaveURL(/#\/backpacks$/, { timeout: 10000 });
    await expect(page.locator(".first-run-guide")).toHaveAttribute("data-guide-status", "active");

    await gotoHall(page, "workshop");
    await expect(page.getByTestId("hall-card-workshop")).toBeVisible();
  });

  test("6. the schedule hall states its role in both empty states", async ({ page }) => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/baseline-smoke-fixture.json", import.meta.url), "utf8"));
    await loadFixtureAndBoot(page, fixture);
    await gotoHall(page, "schedule");
    // The detail column is empty until a room is picked -- always true on
    // arrival, whether or not this profile happens to own rooms.
    const detailNote = page.getByTestId("schedule-detail-role-note");
    await expect(detailNote).toBeVisible();
    await expect(detailNote).toContainText("Sortie");
  });
});

test.describe("REQ-0376 Dex glossary", () => {
  const TERMS = ["canvas", "bp", "po", "si", "unit", "connshape", "link", "squad", "troop", "tm", "lrdst"];
  const RULES = ["autorepeat", "draw", "decay", "burn", "finality", "currency"];

  async function openTerms(page: Page, label: string): Promise<void> {
    await page.locator(".dex-tab", { hasText: label }).click();
    await expect(page.locator(".dex-tab-active", { hasText: label })).toBeVisible();
    await expect(page.getByTestId("dex-glossary")).toBeVisible();
  }

  async function expectComplete(page: Page): Promise<void> {
    for (const id of TERMS) {
      const row = page.getByTestId("dex-glossary-term-" + id);
      await expect(row).toBeVisible();
      await expect(row.locator(".dex-glossary-term")).not.toBeEmpty();
      await expect(row.locator(".dex-glossary-desc")).not.toBeEmpty();
    }
    for (const id of RULES) {
      const row = page.getByTestId("dex-glossary-rule-" + id);
      await expect(row).toBeVisible();
      await expect(row.locator(".dex-glossary-desc")).not.toBeEmpty();
    }
  }

  test("7. the Terms tab renders complete in EN and in JA", async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => { window.location.hash = "#/dex"; });
    // Items is still the default tab, and the existing tabs are untouched.
    await expect(page.locator(".dex-tab-active", { hasText: "Items" })).toBeVisible();
    for (const label of ["Items", "Units", "Monsters", "Gimics", "Terms"]) {
      await expect(page.locator(".dex-tab", { hasText: label })).toBeVisible();
    }

    await openTerms(page, "Terms");
    await expectComplete(page);
    // Nothing fell through to a raw key (t() echoes the key when a locale
    // lacks it -- the one way a missing string ships silently).
    await expect(page.getByTestId("dex-glossary")).not.toContainText("guide.glossary.");

    await page.locator(".lang-toggle").click();
    await openTerms(page, "用語");
    await expectComplete(page);
    await expect(page.getByTestId("dex-glossary")).not.toContainText("guide.glossary.");

    // Leaving Terms returns the Items master/detail exactly as it was.
    await page.locator(".dex-tab", { hasText: "アイテム" }).click();
    await expect(page.getByTestId("dex-glossary")).toHaveCount(0);
    await expect(page.locator(".dex-md")).toBeVisible();
  });
});
