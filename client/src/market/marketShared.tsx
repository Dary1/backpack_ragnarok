// client/src/market/marketShared.tsx -- REQ-0064 shared helpers for the
// Market (交易の火床 / Hearth of Barter) panes. Pure rendering/derivation
// glue: burn math (client mirror of the server law, for live estimates),
// item-def resolution off the store's content map, and the ONE thumbnail
// component every market card/row reuses (delegates to the shared
// dex/ShapeGrid + render/itemCard path -- NOT a third item-render path).
import type { ApiMarketListing } from '../api';
import { iconDataUrl, iconDims } from '../dex/dexIcons';
import { ShapeGrid } from '../dex/ShapeGrid';
import type { GameData } from '../api';
import { t } from '../i18n';
import type { Locale } from '../store';

/** THE burn function (law 2), a byte-identical client mirror of
 * server/services/market.cjs's burnOf (and the mock's own) so the SELL
 * stepper + BUY modal can show a live burn estimate WITHOUT a round trip.
 * The server remains the sole authority that actually burns; this is a
 * display-only recompute, and its output is always reconciled against the
 * server's own `burn`/`sellerReceives` fields once a listing exists. */
export function burnOf(qty: number): number {
  return Math.max(1, Math.ceil(qty * 0.08));
}

export const MARKET_PRICE_MIN = 1;
export const MARKET_PRICE_MAX = 999;

/** REQ-0195a: the short label for a TM id -- the content tms def's `short`
 * (e.g. 'LRDST'), falling back to the id upper-cased when that def is not
 * in the loaded content map. */
export function tmShortLabel(gameData: GameData | null, tm: string): string {
  const short = gameData?.TMS?.[tm]?.short;
  return typeof short === 'string' && short ? short : tm.toUpperCase();
}

/** REQ-0195a: the price currency indicator. Renders the classic fehu rune
 * (ᚠ) for the mock look, and -- WHEN more than one TM is live -- ALWAYS
 * follows it with the price TM's short label, because a lone rune is
 * ambiguous once prices can be carved in different TMs (the whole point of
 * REQ-0195a). With exactly one live TM the output is byte-for-byte today's
 * lone rune (mock look + existing e2e stay stable). Dropped in wherever a
 * bare `ᚠ` price glyph appeared before. */
export function PriceTag({ gameData, tm, multi }: { gameData: GameData | null; tm: string; multi: boolean }) {
  if (!multi) return <span className="rune">ᚠ</span>;
  return (
    <>
      <span className="rune">ᚠ</span>
      <span className="market-price-tm" data-testid="market-price-tm">{tmShortLabel(gameData, tm)}</span>
    </>
  );
}

/** The item def (icon/shape/rarity/tags) for a listing's content itemId,
 * resolved off the store's already-loaded /api/content map -- exactly the
 * "the full item def still comes from fetchContent()'s items map by
 * itemId" contract the server DTO documents. Returns null for a pilot-
 * only item absent from the live content map (thumbnail falls back to an
 * empty well, name still shows from the DTO's own itemName). */
export function itemDefFor(gameData: GameData | null, itemId: string) {
  if (!gameData) return null;
  return gameData.ITEMS[itemId] || null;
}

interface MarketThumbProps {
  gameData: GameData | null;
  itemId: string;
  /** REQ-0195b: a tm listing has no PO def -- render the currency rune. */
  kind?: string;
  /** Icon well pixel budget per cell (mock: 64px wells on cards, 46px on
   * mine rows). ShapeGrid multiplies this by the footprint. */
  cellPx?: number;
  alt?: string;
}

/** The one item thumbnail used across every market surface. Mounts the
 * item's icon across its full shape footprint via the shared ShapeGrid
 * (same component the Dex catalog uses), so a 2x2 cleaver reads as a
 * cleaver, not a squished corner. Falls back to an empty well when the
 * def/icon is unknown. */
export function MarketThumb({ gameData, itemId, cellPx = 22, alt, kind }: MarketThumbProps) {
  if (kind === 'tm') {
    return <span className="market-thumb market-thumb-tm" aria-hidden="true"><span className="rune">ᚠ</span></span>;
  }
  if (kind === 'si') {
    const sdef = gameData?.SI_DEFS?.[itemId] ?? null;
    if (!sdef) return <span className="market-thumb market-thumb-empty" aria-hidden="true" />;
    return (
      <span className="market-thumb">
        <ShapeGrid shape={[[0, 0]]} cellPx={cellPx} iconUrl={iconDataUrl(sdef.icon)} iconAlt={alt ?? sdef.icon} iconDims={iconDims(sdef.icon)} />
      </span>
    );
  }
  if (kind === 'unit') {
    const udef = (gameData?.UNITS?.[itemId] ?? null) as { icon?: string } | null;
    if (!udef?.icon) return <span className="market-thumb market-thumb-empty" aria-hidden="true" />;
    return (
      <span className="market-thumb">
        <ShapeGrid shape={[[0, 0]]} cellPx={cellPx} iconUrl={iconDataUrl(udef.icon)} iconAlt={alt ?? udef.icon} iconDims={iconDims(udef.icon)} />
      </span>
    );
  }
  const def = itemDefFor(gameData, itemId);
  if (!def) return <span className="market-thumb market-thumb-empty" aria-hidden="true" />;
  const icon = iconDataUrl(def.icon);
  return (
    <span className="market-thumb">
      <ShapeGrid
        shape={def.shape}
        cellPx={cellPx}
        iconUrl={icon}
        iconAlt={alt ?? def.icon}
        iconDims={iconDims(def.icon)}
        iconStretch={def.stretch}
        iconAlign={def.align}
      />
    </span>
  );
}

/** "PO ・ 2×2 ・ 斧/霜 RARE"-style sub line, mock-faithful. Kind is fixed
 * 'PO' in v1 (every listing card in the mock is a PO; the service sells
 * inventory POs only). Shape dims come from the def's own bounding box;
 * tags/rarity are the DTO's own (already content-resolved server-side).
 * `rarityWord` is rendered by the caller as a .rar-word span so the theme
 * colors it -- this helper returns the plain pieces. */
export function listingKindLine(listing: ApiMarketListing, gameData: GameData | null): { kind: string; dims: string; tags: string } {
  if (listing.kind === 'tm') {
    return { kind: 'TM', dims: listing.tmQty != null ? `×${listing.tmQty}` : '', tags: '' };
  }
  const def = itemDefFor(gameData, listing.itemId);
  let dims = '';
  if (def && Array.isArray(def.shape) && def.shape.length > 0) {
    const rows = Math.max(...def.shape.map((c) => c[0])) + 1;
    const cols = Math.max(...def.shape.map((c) => c[1])) + 1;
    dims = `${cols}×${rows}`;
  }
  const tags = (listing.tags || []).join('/');
  return { kind: (listing.kind || 'po').toUpperCase(), dims, tags };
}

/** The player-facing Dex-No chip text ("No.061" / "No.—" when the item
 * isn't in the dex yet). Zero-padded to 3 like the mock. */
export function dexNoLabel(dexNo: number | null): string {
  if (dexNo == null) return 'No.—';
  return `No.${String(dexNo).padStart(3, '0')}`;
}


/** REQ-0195e: the roll-fulfillment bar. A drop instance's hack-and-slash
 * performance sits somewhere between its def's min (0%) and max (100%);
 * rollPct is that fraction (0..1), DTO-derived (never stored). po/si
 * always carry it (the instance q, REQ-0063). A unit carries bp.roll?.pct
 * once the REQ-0196 container fills, else null -> the "unmeasured" badge
 * (未測定), NEVER a 0% bar (user ruling 2026-07-16). A tm has no roll ->
 * render nothing. */
export function RollBar({ kind, rollPct, locale }: { kind: string; rollPct: number | null | undefined; locale: Locale }) {
  if (kind === 'tm') return null;
  if (rollPct == null) {
    return <span className="market-rollbadge" data-testid="market-roll-unmeasured">{t(locale, 'market.roll.unmeasured')}</span>;
  }
  const pct = Math.max(0, Math.min(100, Math.round(rollPct * 100)));
  return (
    <div className="market-rollbar" data-testid="market-rollbar" data-roll-pct={pct} title={t(locale, 'market.roll.title', { pct })}>
      <span className="market-rollbar-fill" style={{ width: `${pct}%` }} />
      <span className="market-rollbar-label">{pct}%</span>
    </div>
  );
}
