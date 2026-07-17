# REQ-0229 — monster portrait backfill: the 7 Niflheim (batch-002) monsters

## State log
- 2026-07-17 reserved (stub).
- 2026-07-17 reserved -> draft: content/art-session work; scheduling belongs
  to the user (art pipeline is user-run -- HANDS-OFF for agents).

## Origin (REQ-0208 retrospective)
REQ-0208's live verification: art_urls resolves adopted renders for 20 of 27
served monsters. Every batch-006 wildlands monster has art; the SEVEN
original batch-002 dungeon-pilot (Niflheim) monsters do not, so the new Dex
Monsters tab shows the rune placeholder for exactly the roster players meet
first:

  frost_gnoll, frostback_bear, glacier_wisp, hrimgrimnir, ice_archer,
  niflheim_stalker, rime_shaman

(zombie/skeleton etc. resolved via existing artworks; list captured live
2026-07-17.)

## Problem
The first-dungeon roster is the least-illustrated part of the bestiary --
inverted from what a player-facing wiki wants. The placeholder is honest but
these 7 are the highest-value portraits to add.

## Proposal
Art-session task (user-run ComfyUI pipeline, monster artwork kind):
generate + inspect + adopt renders for the 7 ids above. Footprints come
from the defs / art_sizing (frostback_bear + hrimgrimnir are multi-cell --
2x2 and larger -- so their canvases follow the monster w x h * 128px rule).
No code change: art_urls picks adopted renders up automatically (REQ-0208),
Dex + monitor surfaces update on the next content poll.

## Acceptance
art_urls resolves 27/27 live monsters (or explicitly waived ids noted here).
