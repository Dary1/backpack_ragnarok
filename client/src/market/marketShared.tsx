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
