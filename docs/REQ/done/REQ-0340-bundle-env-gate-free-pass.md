# REQ-0340 — The bundle-env tripwire was a free pass; repair it and make it watch itself fail

## Status
built — 2026-07-29. Awaiting user acceptance / merge.

`tools/check_bundle_env.sh` (REQ-0278) existed specifically to stop an env-less
client bundle being committed. It did not stop the second occurrence, because
it passed in exactly the situation it was built for.

---

## 1. What kept happening

`web/app` is a **tracked** build artifact whose contents depend on a
**gitignored** input, `client/.env.local`, which by the project secret policy
exists only in the main checkout. Vite inlines `VITE_*` at build time
(`client/src/auth/client.ts`), so a build in a worktree bakes an env-LESS
bundle and sign-in silently degrades to "not configured" (REQ-0118c).

| | |
|---|---|
| REQ-0266 | shipped an env-less bundle; fixed by rebuilding on main (`42238f8`) |
| REQ-0278 | built the countermeasures: `provision_worktree_env.sh` + this tripwire |
| REQ-0337 | **shipped it again** (`2517c83`), hotfixed by `e8f2b77` — with the tripwire in place |

## 2. Why the tripwire did not fire

```sh
if [ ! -f "$ENV_FILE" ]; then
  echo "[bundle-env] NOT APPLICABLE -- no $ENV_FILE in this tree; ..."
  exit 0        # <- pass
fi
```

**A free pass at precisely the accident condition**, in a script whose own
header reads *".env.local ABSENT -> NOT APPLICABLE, with a reason (REQ-0159:
never a free PASS)"*. It was a free PASS.

Two defects, not one:

1. **Free pass.** No `.env.local` ⇒ exit 0. That is the failing tree.
2. **Wrong subject.** It only inspected the tree's *freshly built* output. What
   ships is whatever `web/app` is **committed**, and nothing looked at that.

The second matters more than it sounds: the check could only ever run where the
env already existed, i.e. never where the accident happens.

## 3. The repair

Three checks replace the one. **(A) is env-independent, so it runs in every
worktree — it is the one the accident needed.**

| | check | fires when |
|---|---|---|
| **A** | the built bundle must carry non-empty `VITE_SUPABASE_URL` **and** `VITE_SUPABASE_ANON_KEY` | always |
| **B** | an env-less tree must not have `web/app` dirty | `.env.local` absent |
| **C** | with env present, the bundle must carry THIS tree's host (the original REQ-0278 assertion, unchanged) | `.env.local` present |

B is the direct closure of the free pass: "no env" is acceptable only while
`web/app` is untouched. The moment such a tree produces a bundle, it is the
REQ-0266/0337 accident in progress and the gate says so.

### Detection notes — both of these cost real time, so they are in the file

**Minified output uses BARE identifier keys and BACKTICK values:**

    {BASE_URL:`/app/`,DEV:!1,MODE:`production`,PROD:!0,SSR:!1,
     VITE_SUPABASE_URL:`https://...`,VITE_SUPABASE_ANON_KEY:`eyJ...`}

not `"VITE_SUPABASE_URL": "..."`. While investigating this REQ I probed the live
bundle twice assuming double quotes, concluded both times that production auth
was dead, and **raised a false alarm about a live outage**. It was fine. The
check now matches key-colon-value across all three JS quote styles.

**Grepping for the literal string `VITE_SUPABASE_URL` is not a gate.**
`client.ts` calls `readEnv('VITE_SUPABASE_URL')`, so that string survives into
an env-LESS bundle as a function argument and such a grep returns 1 either way —
always passing. This was the guard originally proposed for PROJECT.md; it would
have reproduced the free pass in a new place. The self-test's "bad" fixture
contains that literal on purpose, so any future rewrite that regresses to a
plain substring search fails immediately.

## 4. `--selftest`: the gate is watched failing on every run

The reason this file needed repairing is that it was *assumed* to be a gate
while being a free pass. A gate nobody has seen fail is a claim, not a check.

`tools/check_bundle_env.sh --selftest` builds both bundle shapes in a temp dir
and asserts the verdicts: env-bearing ⇒ (A) passes; env-less ⇒ (A) rejects,
*despite* the bundle carrying the literal key name. `ci.sh [6.1/7]` now runs
`--selftest` before the real check, so every CI run proves the gate can fail.

> **Recorded because it is the same failure twice:** as first written the
> `--selftest` block sat ABOVE `_check_committed_bundle`'s definition. Bash
> evaluates top-down, so both calls were `command not found` — and the
> "env-less bundle is rejected" line therefore *passed for entirely the wrong
> reason*. A self-test that passes because nothing ran is the free pass again,
> one level up. Caught by noticing the good fixture was also being rejected.

## 5. Verified

| scenario | expected | result |
|---|---|---|
| env-less worktree, `web/app` committed and clean | pass — A ok, B n/a | exit 0 |
| **env-less worktree, client built** (the accident) | **FAIL** | exit 1, A and B both fire |
| env provisioned, rebuilt | pass — A ok, C ok | exit 0, `web/app` byte-identical to HEAD |
| `--selftest` | both verdicts correct | exit 0 |

The third line is worth noting on its own: with `.env.local` present the rebuild
reproduced the committed bundle exactly, so the build is deterministic and the
only variable really is the env.

## 6. Scope, and what this does NOT do

This repairs the gate. It does **not** remove the underlying defect: a tracked
artifact that varies with an untracked input. While that holds, every tree needs
either provisioning or a gate to catch the omission.

The root fix is to stop baking public config into the bundle at all — serve
`{supabaseUrl, supabaseAnonKey}` from the API and build the client at runtime.
Both values are already PUBLIC (`client/.env.example`), so nothing is exposed
that is not exposed today. That would make `web/app` a pure function of
`client/src`, and would let **`provision_worktree_env.sh`, this entire script,
and `ci.sh [6.1/7]` all be deleted** — plus Supabase key rotation would stop
requiring a client rebuild and redeploy. It is tracked separately because it
touches auth bootstrap ordering (`detectSessionInUrl` + PKCE want the client to
exist before the OAuth redirect hash is consumed), and the gate should be
working in the meantime — which is the whole point of doing this one first.

## 7. Files

| file | |
|---|---|
| `tools/check_bundle_env.sh` | rewritten: checks A/B/C + `--selftest`; detection notes in-file |
| `tools/ci.sh` | `[6.1/7]` runs `--selftest` first; the stage comment described the old free-pass behaviour and now describes this |

No product code, no test, no content.

## Log
- 2026-07-29 reserved as REQ-0340 on branch req-0340-bundle-env-gate-free-pass
  (off master fe473b8, i.e. after REQ-0339 landed).
- 2026-07-29 repaired; three scenarios verified including a live reproduction of
  the accident; self-test ordering bug found and fixed; reserved -> built.

## Gate results (2026-07-29)
- `tools/release.sh` **CI GREEN**. `[6.1/7]` selftest both verdicts correct, then (A) OK + (C) OK.
- e2e 204 passed / 0 failed / 1 skipped; admin trio 8/1/28; registry 4/4.

## Deploy record (2026-07-29)
- Merged to master 0d01a35 (--no-ff). Gate before the merge: `tools/release.sh` CI GREEN.
- **No service restart, no dist change**: tools/ and docs/ only. Verified on master
  after the merge: --selftest both verdicts correct, (A) OK, (C) OK.
- built -> done.
