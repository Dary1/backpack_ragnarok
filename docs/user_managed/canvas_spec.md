# Canvas Spec

## Item Types

they are 3 types of items. 

- BP Backpack 
- PO Placement Object 
- SI Socket Item

they are placed on top of each others to make up a unit canvas.

## Placement Layer-1 (Canvas layer)

- **Canvas** — the full placement field of one Unit. A grid containing BPs and Dead Space.
- **BP (Backpack)** — One BackPack placement on the canvas. One backpack provides many cells. It may contain one BP Linker or none.
  - **Cell** — one cell of a BP. A cell provides one placement availability for layer-1.
- **Dead Space** — Canvas cells covered by no BP (white in drafts). Inert.
  - **Backpack-as-HP** the unit does not have HP, its each backpack that has HPs. 

## Placement Layer-2 (Backpack layer)

- **Placement Object (PO)** — anything placed into a BP's cells: items, weapons, and
  the Linker. Polyomino-shaped. **Must fit entirely inside ONE BP** — never spans two.
  Baseline conventions follow the Backpack Hero genre.

- **PO Tag** PO must have a tag. a tag can be a hierachy. eg, Sword is a type of weapon. 

- **PO Connection Port** — a PO may have zero or more connection ports. A port
  declares a tag; it connects to a PO whose tag is the same or within the tag
  hierarchy. Ports are directional (they belong to the sender) and never connect
  across BPs, even if the port tiles reach.

## Placement Layer-3

- **Socket Item** — PO many have a socket which a socket item can fit in. 
- **Socket Type** — a Socket Item can only fit a socket of the same Socket Type,
  or one within the Socket Type hierarchy. This follows the same hierarchical
  matching pattern as PO Tags, but as a separate, independent vocabulary —
  Socket Types and PO Tags never mix or cross-match.


## BackPack Extra Function - Linker

- BP may contain a linker or none. 
- a linker sends linking beams with a beam direction (N/NE/E/SE/S/SW/W/NW)
- **Link Beam** — the straight ray cast from a Linker along each of its beam direction, across the whole Canvas.
- link beam is valid only if on it's way, there is another linker. 
- Hitting one creates a "BP link" from the sender to the receiver. the link beam can not penerate and link multiple linkers at the same time, one link direction only one first hit linker.
- can be **Mutual Link**ed — if two Linkers each targeting the other. Allowed, not always optimal
- **Link effects** (what an established Link does) and **Linker types**: designed
  together with the item system. Items come first; Linker applications follow.

## Relation with Economy(refer to economy.md)

- **Transmutator** — currency doubling as crafting material (PoE-inspired) and the
  Market currency. Nothing further is defined right now.

## Relation with Deployment layer (refer to dungeon_deployment.md)

- **Preset** — a saved Canvas configuration. A player may deploy multiple own Presets
  simultaneously, but one physical item cannot exist in two deployed Presets.

## Decoded example (PBSystem.xlsx, canvas A1:J10)

to illustrate backpacks are colored but they aren't color dependent.

Six BPs by fill color: Ochre `BF9000` (top-left), Gold `F1C232`, Olive `7F6000`
(top-right), Pale `FFD966` (mid-right), Yellow `FFFF00` (bottom-left), Brown `783F04`
(bottom-right). White = Dead Space. One Linker per BP (Pale's is not drawn in the draft).

- `C2` Linker **24** (Ochre): dir 2 → received by `F2` Linker **0** (Gold);
  dir 4 → received by `C8` (Yellow).
- `C8` Linker **0123** (Yellow; "013" in the sheet was a typo, ratified): dir 0 →
  Mutual Link with `C2`; dir 1 → received by `I2` Linker **6** (Olive); dir 2 →
  received by `I8` (Brown); dir 3 → intentional dud.
- `F2` Linker **0** (Gold): beam up hits nothing — intentional dud; F2 acts as a
  pure receiver.
- `I8` Linker **0** (Brown): dir 0 → received by `I2` (Olive).
- `I2` Linker **6** (Olive): dir 6 → first Linker on the line is `F2` (Gold).



