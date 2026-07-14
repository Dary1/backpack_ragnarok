# Canvas Spec

## Item Types

they are 3 types of items. 

- BP Backpack 
- PO Placement Object 
- SI Socket Item

they are placed on top of each others to make up a squad canvas.

## Placement Layer-1 (Canvas layer)

- **Canvas** — the full placement field of one Squad. A grid containing BPs and Dead Space.
- **BP (Backpack)** — One BackPack placement on the canvas. One backpack provides many cells. It carries **exactly one Unit**, seated on one of its own cells; the seat is stamped at mint time and cannot be chosen or moved. A BP without a Unit does not exist.
  - **Cell** — one cell of a BP. A cell provides one placement availability for layer-2, EXCEPT the Unit's own cell, which is taken by the Unit and never accepts a PO.
- **Dead Space** — Canvas cells covered by no BP (white in drafts). Inert.
  - **Backpack-as-HP** the Squad does not have HP; it is each backpack that has HP, and each is destroyed on its own.

## Placement Layer-2 (Backpack layer)

- **Placement Object (PO)** — anything placed into a BP's cells: items and weapons.
  Polyomino-shaped. **Must fit entirely inside ONE BP** — never spans two.
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


## The Unit (ex-Linker)

- every BP carries exactly one Unit, seated on one cell of that BP.
- a Unit sends linking beams along the directions given by its **Connection Shape**
  (queen / rook / bishop / lance / knight / adjacency / none — see REQ-0128b for
  shape resolution; the shape dictionary is `content/vocab.json`).
- **Link Beam** — the straight ray cast from a Unit along each of its beam direction, across the whole Canvas.
- link beam is valid only if on it's way, there is another Unit. 
- Hitting one creates a "Unit Link" from the sender to the receiver. the link beam can not penerate and link multiple Units at the same time, one link direction only one first hit Unit.
- can be **Mutual Link**ed — if two Units each targeting the other. Allowed, not always optimal
- **Link effects** (what an established Link does) and **Unit kits**: designed
  together with the item system. Items come first; Unit applications follow.

## Relation with Economy(refer to economy.md)

- **Transmutator** — currency doubling as crafting material (PoE-inspired) and the
  Market currency. Nothing further is defined right now.

## Relation with Deployment layer (refer to dungeon_deployment.md)

- **Squad** — a saved Canvas configuration. A player may deploy multiple own Squads
  simultaneously, but one physical item cannot exist in two deployed Squads.
  A **Troop** is 4 Squads.

## Decoded example (PBSystem.xlsx, canvas A1:J10)

to illustrate backpacks are colored but they aren't color dependent.

Six BPs by fill color: Ochre `BF9000` (top-left), Gold `F1C232`, Olive `7F6000`
(top-right), Pale `FFD966` (mid-right), Yellow `FFFF00` (bottom-left), Brown `783F04`
(bottom-right). White = Dead Space. One Unit per BP (Pale's is not drawn in the draft).

- `C2` Unit **24** (Ochre): dir 2 → received by `F2` Unit **0** (Gold);
  dir 4 → received by `C8` (Yellow).
- `C8` Unit **0123** (Yellow; "013" in the sheet was a typo, ratified): dir 0 →
  Mutual Link with `C2`; dir 1 → received by `I2` Unit **6** (Olive); dir 2 →
  received by `I8` (Brown); dir 3 → intentional dud.
- `F2` Unit **0** (Gold): beam up hits nothing — intentional dud; F2 acts as a
  pure receiver.
- `I8` Unit **0** (Brown): dir 0 → received by `I2` (Olive).
- `I2` Unit **6** (Olive): dir 6 → first Unit on the line is `F2` (Gold).

Dir numbering is the 8-point compass 0=N,1=NE,2=E,3=SE,4=S,5=SW,6=W,7=NW.
