#!/usr/bin/env python3
"""REQ-0275 -- enemy_bands: derive enemy-side stat bands from OUR LIVE data.

Stdlib only. Reads:
  content/live/dungeon/enemies.json  (enemy/1: hp:[lo,hi], rarity lowercase,
                                      skills:[ids])
  content/live/dungeon/skills.json   (skill/1: trigger/verb, no rarity)

Emits content/enemy_bands.json (TRACKED, DETERMINISTIC: sorted keys, rounded
numbers, a content-hash provenance stamp, NO timestamps -- two runs on the
same inputs are byte-identical).

basis="live_self" is honest: these bands describe our CURRENT live dungeon
meta and flag outliers against TODAY's game, NOT genre truth. The genre wikis
carry no enemy pages, so enemy/skill magnitudes can only be grounded on our
own live content (contrast content/corpus_stats.json bands, which are
ITEM-scope and corpus-derived).

Groups:
  enemy_hp[rarity]        -- stats over hp midpoints, per rarity
  enemy_total_dps[rarity] -- stats over per-enemy TOTAL dps (sum of that
                             enemy's skills' dps proxies), per rarity
  skill_dps               -- pooled stats over the per-skill dps proxies
                             (skill/1 has no rarity); skills with no computable
                             dps are excluded from n and counted as n_na

dps proxy is IDENTICAL to tools/check_stat_bands.cjs defDps(): SUM over effects
of (verb.n mid / trigger.s mid) for effects that are BOTH a damage verb
(strike|multi_strike|charge_strike) AND an every_secs trigger. A skill/1 def's
single top-level trigger/verb is treated as one effect.

Band formula -- multipliers are DATA (in `band_formula`), not code constants,
so the tolerance can be retuned without touching code:
  warn_lo = min * warn_lo_mult    warn_hi = max * warn_hi_mult
  flag_lo = warn_lo / flag_mult   flag_hi = warn_hi * flag_mult
A value outside [warn_lo, warn_hi] is a WARN (outside the observed spread with
a margin); outside [flag_lo, flag_hi] is a FLAG (a magnitude error vs the
current live meta).
"""
import argparse
import hashlib
import json
import math
import os
import sys

SCHEMA = "enemy_bands/1"
BASIS = "live_self"

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
ENEMIES_PATH = os.path.join(REPO, "content", "live", "dungeon", "enemies.json")
SKILLS_PATH = os.path.join(REPO, "content", "live", "dungeon", "skills.json")
OUT_PATH = os.path.join(REPO, "content", "enemy_bands.json")

# Damage verbs whose n is a hit magnitude -- parity with check_stat_bands.cjs.
DAMAGE_VERBS = frozenset(("strike", "multi_strike", "charge_strike"))
# enemy/1 rarity is LOWERCASE; keep the vocab ladder order (Common..Relic).
RARITIES = ("common", "uncommon", "rare", "relic")

# Band tolerance multipliers -- surfaced as DATA in the output band_formula.
WARN_LO_MULT = 0.75
WARN_HI_MULT = 1.25
FLAG_MULT = 2.0
PROVISIONAL_N = 30


def _round(x, nd=3):
    if x is None:
        return None
    return round(float(x), nd) + 0.0  # +0.0 normalises -0.0 -> 0.0


def _mid(rng):
    """Midpoint of a [lo, hi] range. Parity with check_stat_bands mid()."""
    if not isinstance(rng, (list, tuple)) or len(rng) < 2:
        return None
    try:
        a = float(rng[0])
        b = float(rng[1])
    except (TypeError, ValueError):
        return None
    if math.isnan(a) or math.isnan(b):
        return None
    return (a + b) / 2.0


def _percentile(sorted_vals, q):
    """Linear-interpolation percentile (q in 0..100). Same method as
    corpus_stats._percentile so the two tools speak the same statistics."""
    n = len(sorted_vals)
    if n == 0:
        return None
    if n == 1:
        return sorted_vals[0]
    rank = (q / 100.0) * (n - 1)
    lo = int(math.floor(rank))
    hi = int(math.ceil(rank))
    if lo == hi:
        return sorted_vals[lo]
    frac = rank - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


def _effects_of(defn):
    """Normalise a def to a list of {trigger, verb}. po/2 items carry an
    effects[] array; a skill/1 def carries one top-level trigger/verb. Parity
    with check_stat_bands.cjs effectsOf()."""
    effs = defn.get("effects")
    if isinstance(effs, list):
        return effs
    if defn.get("trigger") and defn.get("verb"):
        return [{"trigger": defn["trigger"], "verb": defn["verb"]}]
    return []


def def_dps(defn):
    """Summed damage dps-proxy of a def. FAITHFUL port of
    check_stat_bands.cjs defDps(): SUM over effects of (verb.n mid /
    trigger.s mid) for effects that are BOTH a damage verb AND an every_secs
    trigger. Returns (dps, counted)."""
    dps = 0.0
    counted = 0
    for eff in _effects_of(defn):
        trig = eff.get("trigger") or {}
        verb = eff.get("verb") or {}
        if trig.get("t") != "every_secs":
            continue
        if verb.get("t") not in DAMAGE_VERBS:
            continue
        n_mid = _mid(verb.get("n"))
        s_mid = _mid(trig.get("s"))
        if n_mid is None or s_mid is None or s_mid <= 0:
            continue
        dps += n_mid / s_mid
        counted += 1
    return dps, counted


def _band(mn, mx):
    """warn_lo/warn_hi from the RAW observed extremes; flag_multiple is data."""
    return {
        "warn_lo": _round(mn * WARN_LO_MULT),
        "warn_hi": _round(mx * WARN_HI_MULT),
        "flag_multiple": FLAG_MULT,
    }


def _group_stats(values):
    """{n, provisional, min, p25, median, p75, max, band} over `values`.
    band is null for an empty group."""
    vals = sorted(float(v) for v in values)
    n = len(vals)
    out = {"n": n, "provisional": n < PROVISIONAL_N}
    if n == 0:
        out.update({"min": None, "p25": None, "median": None,
                    "p75": None, "max": None, "band": None})
        return out
    mn = vals[0]
    mx = vals[-1]
    out.update({
        "min": _round(mn),
        "p25": _round(_percentile(vals, 25)),
        "median": _round(_percentile(vals, 50)),
        "p75": _round(_percentile(vals, 75)),
        "max": _round(mx),
        "band": _band(mn, mx),
    })
    return out


def _skill_dps_group(skills):
    """Pooled per-skill dps stats; skills with no computable dps are excluded
    from n and reported as n_na."""
    vals = []
    n_na = 0
    for s in skills:
        dps, counted = def_dps(s)
        if counted > 0:
            vals.append(dps)
        else:
            n_na += 1
    g = _group_stats(vals)
    g["n_na"] = n_na
    return g


def _content_hash(enemies, skills):
    """Deterministic content hash over the input fields that drive the output
    (provenance). No timestamp -> stable across reruns."""
    en = sorted(
        ({"id": e.get("id"), "hp": e.get("hp"), "rarity": e.get("rarity"),
          "skills": e.get("skills")} for e in enemies),
        key=lambda d: d["id"] or "")
    sk = sorted(
        ({"id": s.get("id"), "trigger": s.get("trigger"), "verb": s.get("verb")}
         for s in skills),
        key=lambda d: d["id"] or "")
    blob = json.dumps({"enemies": en, "skills": sk}, sort_keys=True,
                      ensure_ascii=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(blob.encode("utf-8")).hexdigest()


def compute_bands(enemies, skills):
    """Pure: enemies = enemy/1 entries, skills = skill/1 entries. Returns the
    deterministic enemy_bands dict."""
    skills_by_id = {s.get("id"): s for s in skills}
    hp_by_rar = {r: [] for r in RARITIES}
    dps_by_rar = {r: [] for r in RARITIES}
    for e in enemies:
        r = e.get("rarity")
        if r not in hp_by_rar:
            continue  # unknown rarity -> not banded (closed vocab)
        hpm = _mid(e.get("hp"))
        if hpm is not None:
            hp_by_rar[r].append(hpm)
        total = 0.0
        for sid in e.get("skills", []) or []:
            s = skills_by_id.get(sid)
            if s is None:
                continue
            d, _c = def_dps(s)
            total += d
        dps_by_rar[r].append(total)

    enemy_hp = {r: _group_stats(hp_by_rar[r]) for r in RARITIES}
    enemy_total_dps = {r: _group_stats(dps_by_rar[r]) for r in RARITIES}
    skill_dps = _skill_dps_group(skills)

    return {
        "schema": SCHEMA,
        "basis": BASIS,
        "generated_from": _content_hash(enemies, skills),
        "band_formula": {
            "warn_lo_mult": WARN_LO_MULT,
            "warn_hi_mult": WARN_HI_MULT,
            "flag_mult": FLAG_MULT,
            "provisional_below_n": PROVISIONAL_N,
            "description": (
                "For each group over its observed values: warn_lo = "
                "round(min * warn_lo_mult, 3), warn_hi = round(max * "
                "warn_hi_mult, 3), where min/max are the observed extremes. A "
                "value < warn_lo or > warn_hi is a WARN (outside the observed "
                "spread by the warn margin). flag_lo = warn_lo / flag_mult, "
                "flag_hi = warn_hi * flag_mult; a value < flag_lo or > flag_hi "
                "is a FLAG (a magnitude error vs the CURRENT live meta). "
                "Multipliers are data here, not code constants, so the "
                "tolerance can be retuned without a code change. band is null "
                "for an empty group. dps proxy = SUM over effects of "
                "(verb.n mid / trigger.s mid) for a damage verb "
                "(strike|multi_strike|charge_strike) + every_secs trigger, "
                "identical to tools/check_stat_bands.cjs."
            ),
        },
        "note": (
            "basis=live_self: these bands describe our CURRENT live dungeon "
            "meta and flag outliers against TODAY's game, not genre truth -- "
            "the genre wikis carry no enemy pages. Each group carries "
            "provisional=true when n<30 (every per-rarity enemy group here is "
            "provisional; skill_dps pools all skills because skill/1 carries "
            "no rarity). Regenerate with tools/enemy_bands.py after any live "
            "enemies.json / skills.json change."
        ),
        "enemy_hp": enemy_hp,
        "enemy_total_dps": enemy_total_dps,
        "skill_dps": skill_dps,
    }


def canonical_json(obj):
    return json.dumps(obj, sort_keys=True, ensure_ascii=True, indent=2) + "\n"


def _load_entries(path):
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    return doc.get("entries", []) or []


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Derive enemy-side stat bands from live dungeon data "
                    "(REQ-0275).")
    ap.add_argument("--enemies", default=ENEMIES_PATH,
                    help="live enemy/1 file")
    ap.add_argument("--skills", default=SKILLS_PATH, help="live skill/1 file")
    ap.add_argument("--out", default=OUT_PATH,
                    help="tracked enemy_bands JSON output")
    args = ap.parse_args(argv)

    enemies = _load_entries(args.enemies)
    skills = _load_entries(args.skills)
    if not enemies:
        print("no enemies found in %s" % args.enemies, file=sys.stderr)
        return 1
    if not skills:
        print("no skills found in %s" % args.skills, file=sys.stderr)
        return 1

    bands = compute_bands(enemies, skills)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(canonical_json(bands))
    print("wrote %s (%d enemies, %d skills)" %
          (args.out, len(enemies), len(skills)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
