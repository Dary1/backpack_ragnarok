# REQ-0323 — Replace the REQ-derived port rule with a runtime lease allocator

- **State**: todo
- **Owner decision**: 2026-07-27, in chat. Ratified: stop deriving ports from REQ
  numbers; reserve a pool, hand out the lowest free block at call time, print it.
- **Supersedes**: REQ-0322 (the gate's regex blind spot) — folded in, see §7.
- **Depends on**: REQ-0251 (merged `b2185cc`) — `tools/e2e_harness.sh` sources
  `e2e_ports.sh`, so this REQ changes the implementation underneath it, not it.
- **Size**: M.

## 1. Why the derived rule goes

The rule's promise was *"derived ports cannot collide"*. That is only true while
every harness obeys it, which is why a gate had to be built to enforce it — and
that gate has been found defective twice in a single day: REQ-0321 restored a
whole missing half (it never read the configs), and REQ-0322 found that its port
pattern `\b[A-Z_]*PORT[A-Z_]*` cannot match `E2E_PROXY_PORT=`, the exact spelling
harnesses actually write.

The rule also drags a permanent tail of arithmetic: a base, a ceiling derived from
the kernel's ephemeral floor, two poisoned decades, and a REQ-2775 wall. REQ-0251's
own audit and REQ-0321 spent real effort arguing about where that base should sit.
None of it is about testing anything.

**Check reality instead of predicting it.** Ask the OS what is free, take it, write
down that you took it. The base, the ceiling, the poisoned decades and the wall all
cease to exist as concepts.

## 2. The design

### 2.1 Pool

`9000-9999`, in **100 aligned blocks of 10** (9000-9009, 9010-9019, …).

Measured on llmlocal 2026-07-27: nothing listens anywhere in 9000-32767 except
20241/20242. The whole pool is free today, sits well clear of the shared services
(8801/8802/8803, fleet 8810+) and well below the kernel ephemeral floor
(`/proc/sys/net/ipv4/ip_local_port_range` = 32768 60999). **Re-measure at
implementation time; do not trust this paragraph.**

Blocks of 10, not single ports, because a caller needs a set (api, proxy, several
fleet workers) and a contiguous block keeps `E2E_PORT_BASE + 4` arithmetic working
unchanged and shows up as one cluster in `ss -lnt`. 100 blocks covers ~10 parallel
agents at ~5 blocks each with 2x headroom — the owner runs about ten at once.

### 2.2 Leases

State dir `~/backpack_ragnarok_state/e2e_ports/` — host-local, outside every git
tree, sibling of the existing `req/` allocator dir. One file per leased block,
named for its base port, containing pid, caller, timestamp.

**Create the lease with `O_EXCL`.** That is atomic in the kernel, so two callers
racing for the same block cannot both win — the loser's create fails and it moves
to the next block. No lock file, no queue, no flock. This is the same primitive
`touch_next_req_reserved.py` already uses for its `issued/NNNN` markers.

*(Design note, recorded because it was argued: an earlier draft proposed flock.
That was over-engineering. The lease files have to exist anyway to serve `--who`;
once they exist, using them for exclusion is free, and `O_EXCL` is all the mutual
exclusion needed.)*

### 2.3 Allocation

Scan blocks ascending. Skip a block if:
- a lease file exists **and** its pid is still alive (a dead pid's lease is stale
  and gets reclaimed — no timeout to tune), or
- any port in it is in use. **Count `TIME_WAIT` as in use**: a just-released port
  can refuse a bind for tens of seconds, and that would look exactly like the flake
  this REQ exists to remove.

Then `O_EXCL`-create the lease. If that fails, someone won the race — continue.

### 2.4 Release, and the backstop

The harness's existing cleanup trap deletes its lease. A crashed run leaves a lease
whose pid is dead, reclaimed on the next scan.

**Retry on bind failure** (owner's instruction, and correct): the allocator shrinks
the race but cannot erase it, so if bringup still fails to bind, release the block,
lease another, and retry — bounded, say 3 attempts, then fail loudly.
`tools/e2e_harness.sh` is the right place: it already owns spawn + readiness-wait.

### 2.5 The call, and what it prints

No arguments. Every current call site passes a REQ number; **make that an error**,
so any site not updated by this REQ fails immediately and visibly instead of
silently deriving something.

    source tools/e2e_ports.sh

Exports the same names as today — `STATICPORT`, `APIPORT`, `PROXYPORT`,
`E2E_PORT_BASE` — so no harness body changes. Prints to stdout, in plain words,
because both a human and an LLM read the transcript to find out what happened:

    [e2e-ports] leased block 9010-9019 for artadmin_e2e.sh (pid 12345)
                YOUR API PORT IS 9011.  YOUR PROXY PORT IS 9012.
                YOUR FLEET WORKERS ARE 9014-9019.

`tools/e2e_ports.sh --who` lists live leases: block, caller, pid, age. This is what
replaces "a port names its owner on sight" — and it names the *actual* owner rather
than a nominal one, so it survives a harness being renamed.

## 3. Call sites to update

`tools/ci.sh` (`[0/8]` and `[7/7]`), `tools/e2e_harness.sh`, and the four harnesses
`art_inspect_e2e.sh` / `artadmin_e2e.sh` / `content_admin_e2e.sh` /
`registry_first_e2e.sh`. All currently pass a REQ number; all stop.

`client/e2e/*.config.ts` baseURL defaults can no longer name a port at all. Make
the default read `PLAYWRIGHT_BASE_URL` and fail with a clear message if it is
absent, rather than falling back to a literal.

## 4. What this REQ DELETES

From `tools/e2e_ports.sh`: the 5000 base, the 0001-2775 range check, the
0380/0381 poisoning, the ceiling arithmetic and every worked example. From
`tools/check_e2e_ports.cjs`: the whole derivation check (§7).

Also removes the need for the "pre-burn 0380/0381 in the REQ allocator" proposal
raised in chat, and closes REQ-0251's `OPEN — the 5000 base is challenged by its
own arithmetic` section by making the base cease to exist.

## 5. Non-goals

1. **Do not touch `tools/e2e_harness.sh`'s design.** REQ-0251 just landed it; this
   REQ only changes how it gets its ports plus the retry loop of §2.4.
2. **This does not fix the 4-worker e2e flake.** Five independent observations,
   different spec each time; the last one looks like shared dev-player state across
   workers, not ports. It stays REQ-0222's.
3. No change to the permanent services (8801/8802/8803, fleet 8810+).

## 6. Gates

| # | Gate |
|---|---|
| G1 | `tools/ci.sh` green, `[6.5/8]` and `[6.6/8]` genuinely running (not skipped) |
| G2 | Every harness observed via `ss -lnt` binding only inside its own leased block |
| G3 | **Concurrency**: run two harnesses simultaneously and prove they get different blocks. The old rule was only ever statically enforced; this one can be tested for real, so test it. Then run ten at once. |
| G4 | A killed run's lease is reclaimed by the next call (kill -9 mid-run, then allocate) |
| G5 | `--who` shows live leases and nothing stale |
| G6 | No literal pool-range port survives anywhere in `tools/*_e2e.sh`, `tools/e2e_harness.sh`, `tools/ci.sh`, `client/e2e/**` |
| G7 | A call site still passing a REQ number fails loudly (plant one, verify, revert) |

G3 is the point of the whole REQ: the previous scheme could only be argued about,
this one can be measured.

## 7. Folded in: REQ-0322

The gate's job changes. It no longer verifies "is this port derived from its REQ
number" — nothing derives any more. It becomes: **no file may contain a literal
port inside the pool range.** That is a simpler rule and a simpler pattern, and it
makes REQ-0322's `E2E_PROXY_PORT=` blind spot moot by construction, since the check
is now on the *number*, not on the variable name.

Keep the planted-negative self-test REQ-0322 asks for — the blind spot existed
because nothing proved the detector detected. Move REQ-0322 to `done/` when this
lands, recording that it was superseded rather than implemented.

## 8. Outcome

*(to be filled at build time.)*
