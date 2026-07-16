// Global held-TM balance HUD -- REQ-0205 (所持TMをグローバルに表示).
//
// A compact currency strip that lives in the app-wide HUD bar (Header.tsx,
// which App.tsx renders on EVERY non-landing route -- canvas / #market /
// #schedule / #warehouse / #workshop / #dex / ...), so the player's held
// Transmutator-currency balances are visible everywhere, not only inside the
// market/workshop pages that happen to sum them for their own pickers.
//
// Subscription: this is chrome, so it self-subscribes via useGameStore() --
// exactly the pattern CanvasStatsChip uses. useGameStore returns a FRESH
// snapshot wrapper on every stateVersion bump (store/core.ts), so a balance
// mutation (market buy/sell, workshop gacha) re-renders this strip with no
// prop plumbing from App.
//
// Balance source: the SAME reduction market/SellPane.tsx runs -- sum qty per
// TM id across every inventory page (state.inv.pages[].tms[]). There is no new
// source of truth here; this is a read-only mirror of state.inv.
//
// Order: LIVE TM REGISTRY order. gameData.TMS is built id-keyed from
// content/live/live_tms.json's entry order (server/lib/content.cjs iterates
// entries in file order), so Object.keys(TMS) IS the registry order (lrdst
// first, then the REQ-0204 placeholders).
import { iconDataUrl } from './dex/dexIcons';
import { t } from './i18n';
import { useGameStore } from './store';

export function TmHud() {
  const { state, gameData, locale } = useGameStore();
  // Nothing to show until the content payload + a canvas have loaded.
  if (!state || !gameData) return null;

  // Sum held qty per TM id across every inventory page.
  const held = new Map<string, number>();
  for (const pg of state.inv?.pages ?? []) {
    for (const tm of pg.tms ?? []) {
      held.set(tm.id, (held.get(tm.id) ?? 0) + (tm.qty || 0));
    }
  }

  // One chip per HELD (total qty > 0) TM, in live registry order.
  const chips = Object.keys(gameData.TMS)
    .map((id) => ({ id, def: gameData.TMS[id], qty: held.get(id) ?? 0 }))
    .filter((c) => c.def && c.qty > 0);

  // Empty state: hold nothing -> render nothing (no empty chrome).
  if (chips.length === 0) return null;

  return (
    <div className="tm-hud" data-testid="tm-hud" aria-label={t(locale, 'hud.tmAria')}>
      {chips.map(({ id, def, qty }) => {
        // Tooltip = the TM's full CONTENT-i18n name (locale-aware), + the count.
        const name = locale === 'ja' ? (def.i18n?.ja?.name ?? def.name_ja ?? def.name) : def.name;
        const iconUrl = iconDataUrl(def.icon);
        return (
          <span
            key={id}
            className="tm-hud-chip"
            data-testid="tm-hud-chip"
            data-tm-id={id}
            title={`${name} ×${qty}`}
          >
            {iconUrl ? <img className="tm-hud-ico" src={iconUrl} alt="" aria-hidden="true" /> : null}
            <span className="tm-hud-short">{def.short}</span>
            <b className="tm-hud-qty">×{qty}</b>
          </span>
        );
      })}
    </div>
  );
}
