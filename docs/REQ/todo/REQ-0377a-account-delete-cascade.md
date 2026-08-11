# REQ-0377a — Account deletion: the per-player storage cascade

## Status
todo — split out of REQ-0377 item 7 on 2026-08-11, under that bundle's own
rule ("split into REQ-0377a/b/... files the moment items diverge in status").
The EXPORT half of item 7 shipped in REQ-0377 (`client/src/lib/exportProfile.ts`
+ the Settings "Your data" block). This is the DELETE half, which did not.

## Why it split
Item 7 called itself "Largest item; expected to split out", and the reason
turned out to be sharper than a size estimate.

**There is no cascade to lean on.** `server/migrations/001_init.sql` says so in
its own closing comment: *"no DELETE-cascading FKs between the two tables
(profiles.player_id references a player only by convention -- storage.cjs's
isAllowedProfileId() enforces that at the application layer, same as the pre-pg
files backend did)"*. Every later migration that uses `REFERENCES ... ON DELETE
CASCADE` (007/008/009/015/023) does so inside the ARTWORK and CONTENT graphs,
never from player data. So `DELETE FROM players` removes a credential and
orphans everything else.

The cascade therefore has to be written by hand, once per subsystem, twice per
subsystem (files and pg both, because "Both backends must pass the same
api_test suite" — architecture.md rule 4). Shipping a partial one under a
button labelled "delete my account" would be worse than shipping nothing: it
is a promise the code does not keep.

## Inventory — every per-player root, and what already exists
Taken from `server/storage.cjs`'s export list. "have" = a delete/clear
primitive already exists; "need" = this REQ writes one.

| Subsystem | Keyed by | Primitive |
|---|---|---|
| profiles | playerId | **need** `deleteProfile` |
| players (the credential) | playerId | **need** `deletePlayer` |
| rooms | ownerId | have `clearRoomsForOwner` |
| runs | roomId | **need** — orphaned by the room delete above |
| warehouse | playerId | have `clearWarehouseForPlayer` |
| gacha pending | playerId | have `listGachaPending` + `deleteGachaPending` |
| dismantle ledger | playerId | **need** delete |
| market listings | sellerId | **need** — and see the ruling below |
| ragnarok einherjar | playerId | have `listEinherjarRecords` + `deleteEinherjarRecord` |
| notifications | playerId | **need** delete |
| starter claims | playerId | **need** delete |
| skin prefs | playerId | have `deleteSkinPrefs` |
| bp skin slots | BP id | **need** — reachable only via the profile's BPs, so it must run BEFORE the profile delete |
| bio | BP id | same ordering constraint as skin slots |
| seals | runId | **need** — reachable via the player's runs |

## Open decisions (this is why it is `todo`, not `built`)
1. **Market listings and the furnace ledger.** An ACTIVE listing must not
   simply vanish — a buyer may be mid-purchase, and `services/market/trade.cjs`
   settles in seven ordered steps. Withdraw-then-delete is the likely answer.
   The furnace ledger and the dex price history are DIFFERENT: they are market
   history, not personal data (the furnace entry carries a listingId, the dex
   history carries no player id at all), and deleting them would rewrite the
   economy's books. Proposed ruling: **withdraw the player's listings, keep the
   furnace and dex history.** Needs the user's call.
2. **Anonymise or erase the players row?** Erasing frees the id for reuse;
   anonymising keeps referential sanity for anything that recorded a
   `sellerId`/`buyerId`/`ownerId` in history. Interacts with decision 1.
3. **Supabase identity.** REQ-0118c links a Supabase auth id to the player
   (`players.linkAuthId`). Deleting the game player without unlinking leaves a
   Discord account that can sign in and be handed a fresh empty player — which
   may be exactly right, or may be surprising. Needs a stated answer either way.
4. **Ordering + failure.** The cascade is not transactional across the two
   backends. Decide the order (BP-keyed roots first, credential LAST so an
   interrupted delete is resumable rather than a locked-out orphan) and whether
   a partial failure retries or reports.

## Gates
`server/tests/api_test.cjs` in BOTH backends, with a test that creates a player,
gives it a row in every root in the table above, deletes, and then asserts each
root is empty — the assertion has to be per-root, because a cascade test that
only checks the profile is exactly how a subsystem gets forgotten. Plus an e2e
for the confirm flow. CI GREEN.

## Out of scope
The export half (shipped in REQ-0377). Anything about Steam (REQ-0118b), though
this REQ is its prerequisite.
