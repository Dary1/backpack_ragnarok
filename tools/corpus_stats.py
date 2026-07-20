#!/usr/bin/env python3
"""REQ-0268 -- corpus_stats: derive stat curves from the normalized corpus.

Stdlib only. Reads data/corpus/normalized/<source>.json (from
corpus_normalize.py) and emits two artifacts:

  * content/corpus_stats.json  (TRACKED, small, DETERMINISTIC)
        Reruns on the same corpus are byte-identical: sorted keys, rounded
        numbers, stable arrays, NO timestamps.
  * data/corpus/report.md      (untracked, human-readable summary)

Content: per-source and pooled rarity distributions; per-rarity stats
(n/mean/median/p25/p75/p95) for damage-mid, cadence-mid, dps-proxy
(damage_mid/cadence_mid) and hp; verb frequency; a rarity-ratio curve (each
rarity's median dps-proxy relative to Common); and derived `bands` -- OUR
per-rarity dps warn ceilings = the corpus ratio curve anchored to our vocab
`dps_ceiling_warn` values, ISOTONIC (PAVA) CLAMPED so the ceilings are
non-decreasing Common -> Uncommon -> Rare -> Relic (small per-tier sample
sizes can otherwise produce a non-monotonic ratio curve by sampling noise;
see `_pava_isotonic` / `_derive_bands`).

Reference-only (REQ-0268): these are OUR curves, informed by the corpus. No
corpus number is copied verbatim into live content.
"""
import argparse
import json
import math
import os
import sys

SCHEMA = "corpus_stats/1"
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
NORM_ROOT = os.path.join(REPO, "data", "corpus", "normalized")
VOCAB_PATH = os.path.join(REPO, "content", "vocab.json")
STATS_OUT = os.path.join(REPO, "content", "corpus_stats.json")
REPORT_OUT = os.path.join(REPO, "data", "corpus", "report.md")

TIERS = ("Common", "Uncommon", "Rare", "Relic")
METRICS = ("damage_mid", "cadence_mid", "dps_proxy", "hp_mid")


def _round(x, nd=3):
    if x is None:
        return None
    return round(float(x), nd) + 0.0  # +0.0 normalises -0.0 -> 0.0


def _mid(rng):
    if not rng or len(rng) < 2:
        return None
    return (float(rng[0]) + float(rng[1])) / 2.0


def _percentile(sorted_vals, q):
    """Linear-interpolation percentile (q in 0..100) over a sorted list."""
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


def _summary(values):
    vals = sorted(float(v) for v in values if v is not None)
    if not vals:
        return {"n": 0, "mean": None, "median": None,
                "p25": None, "p75": None, "p95": None}
    return {
        "n": len(vals),
        "mean": _round(sum(vals) / len(vals)),
        "median": _round(_percentile(vals, 50)),
        "p25": _round(_percentile(vals, 25)),
        "p75": _round(_percentile(vals, 75)),
        "p95": _round(_percentile(vals, 95)),
    }


def _entry_metrics(entry):
    nums = entry.get("numbers", {}) or {}
    dmg = _mid(nums.get("damage"))
    cad = _mid(nums.get("cadence_secs"))
    hp = _mid(nums.get("hp"))
    dps = None
    if dmg is not None and cad is not None and cad > 0:
        dps = dmg / cad
    return {"damage_mid": dmg, "cadence_mid": cad, "dps_proxy": dps,
            "hp_mid": hp}


def _stats_for_entries(entries):
    """rarity_distribution + per-metric per-rarity summaries + verb freq."""
    dist = {t: 0 for t in TIERS}
    dist["unmapped"] = 0
    # metric -> rarity(or 'all') -> list of values
    buckets = {m: {t: [] for t in TIERS} for m in METRICS}
    for m in METRICS:
        buckets[m]["all"] = []
    verb_freq = {}
    for e in entries:
        rn = e.get("rarity_norm")
        if rn in dist:
            dist[rn] += 1
        else:
            dist["unmapped"] += 1
        em = _entry_metrics(e)
        for m in METRICS:
            v = em[m]
            if v is None:
                continue
            buckets[m]["all"].append(v)
            if rn in TIERS:
                buckets[m][rn].append(v)
        for v in e.get("verbs_mapped", []) or []:
            verb_freq[v] = verb_freq.get(v, 0) + 1

    metrics_out = {}
    for m in METRICS:
        metrics_out[m] = {}
        for key in list(TIERS) + ["all"]:
            metrics_out[m][key] = _summary(buckets[m][key])
    return {
        "rarity_distribution": dist,
        "metrics": metrics_out,
        "verb_frequency": dict(sorted(verb_freq.items())),
        "n_entries": len(entries),
    }


def _ratio_curve(metrics):
    """median dps_proxy[r] / median dps_proxy[Common] for each tier."""
    dps = metrics["dps_proxy"]
    base = dps.get("Common", {}).get("median")
    out = {}
    for t in TIERS:
        med = dps.get(t, {}).get("median")
        if base and base > 0 and med is not None:
            out[t] = _round(med / base)
        else:
            out[t] = None
    return out


def _pava_isotonic(values, weights, anchor_idx=None):
    """Weighted pool-adjacent-violators isotonic regression (non-decreasing).

    `values` / `weights` are same-length lists, in the order that must come
    out non-decreasing. Adjacent values that violate monotonicity are pooled
    into their weighted mean, repeated until the whole sequence is
    non-decreasing (the standard PAVA "stack of blocks" algorithm -- this is
    the exact weighted-least-squares isotonic fit, not a heuristic).

    `anchor_idx`, if given, pins values[anchor_idx] as a FIXED point: any
    pooled block that ends up containing it takes exactly that pinned value
    instead of a weighted mean. This is how a designated anchor tier (Common,
    ratio 1.0 by definition) is kept fixed rather than dragged by pooling --
    the tier(s) merged into its block are effectively clamped to the anchor
    value rather than averaged with it.

    Returns (fitted, groups): fitted[i] is the isotonic value for values[i];
    groups[i] is an int id shared by every index pooled together with i (so
    a group appearing more than once in `groups` was actually pooled).
    """
    anchor_value = values[anchor_idx] if anchor_idx is not None else None
    blocks = []  # each entry: [value, weight, [orig_indices]]
    for i, (v, w) in enumerate(zip(values, weights)):
        blocks.append([v, w, [i]])
        while len(blocks) >= 2 and blocks[-2][0] > blocks[-1][0]:
            b2 = blocks.pop()
            b1 = blocks.pop()
            idxs = b1[2] + b2[2]
            tw = b1[1] + b2[1]
            if anchor_idx is not None and anchor_idx in idxs:
                mv = anchor_value
            else:
                mv = (b1[0] * b1[1] + b2[0] * b2[1]) / tw if tw else 0.0
            blocks.append([mv, tw, idxs])
    fitted = [None] * len(values)
    groups = [None] * len(values)
    for gid, (mv, _w, idxs) in enumerate(blocks):
        for idx in idxs:
            fitted[idx] = mv
            groups[idx] = gid
    return fitted, groups


def _derive_bands(ratio, anchor, weights):
    """OUR per-rarity dps warn ceilings, isotonic (PAVA) clamped so bands are
    non-decreasing Common -> Uncommon -> Rare -> Relic.

    ratio[t]   : corpus median dps_proxy[t] / median dps_proxy[Common], or
                 None if tier t has no corpus dps data. This PRE-clamp value
                 is recorded verbatim per tier as `ratio_raw` -- no
                 information is discarded by the clamp.
    weights[t] : the dps-proxy sample size n for tier t (the PAVA pooling
                 weight -- larger samples resist being pulled by noisier
                 small-n neighbors).

    Tiers with a real corpus ratio are fit with weighted pool-adjacent-
    violators isotonic regression (tier order Common -> Relic), with Common
    pinned as the fixed anchor at ratio 1.0 (see `_pava_isotonic`): Common
    itself never moves; a tier pooled into Common's block is clamped to 1.0
    rather than averaged with it. Tiers with no corpus ratio ("vocab_fallback")
    are not part of that weighted fit (no sample to weight them by) but are
    still clamped, left to right, so the full four-tier sequence shown to
    consumers is non-decreasing.

    basis becomes 'corpus_ratio_isotonic' for a corpus tier whose final ratio
    differs from ratio_raw (pooled with a neighbor, directly or via a
    fallback-tier clamp); an untouched corpus tier keeps 'corpus_ratio'.
    vocab_fallback tiers keep that basis regardless of whether clamping
    changed their effective ratio.
    """
    base = float(anchor.get("Common", 0)) or 0.0
    ratio_raw = {t: ratio.get(t) for t in TIERS}

    if base <= 0:
        # No Common corpus data at all -- nothing to anchor a ratio to.
        # Every tier falls back to the vocab ceiling directly, as before.
        return {t: {"warn_hi": _round(float(anchor.get(t, 0)), 1),
                     "ratio": None, "ratio_raw": ratio_raw[t],
                     "basis": "vocab_fallback"} for t in TIERS}

    corpus_idx = [i for i, t in enumerate(TIERS) if ratio_raw[t] is not None]
    common_idx = TIERS.index("Common")
    values = [ratio_raw[TIERS[i]] for i in corpus_idx]
    wts = [float(weights.get(TIERS[i], 0) or 0) for i in corpus_idx]
    anchor_pos = corpus_idx.index(common_idx) if common_idx in corpus_idx \
        else None
    if values:
        fitted, groups = _pava_isotonic(values, wts, anchor_idx=anchor_pos)
    else:
        fitted, groups = [], []

    fit_ratio = {}
    pooled_tier = {}
    for pos, i in enumerate(corpus_idx):
        t = TIERS[i]
        fit_ratio[t] = _round(fitted[pos])
        pooled_tier[t] = groups.count(groups[pos]) > 1

    bands = {}
    running = None  # running max of the final ratio sequence, left to right
    for t in TIERS:
        if t in fit_ratio:
            r = fit_ratio[t]
            if running is not None and r < running:
                r = running  # clamped up by a preceding vocab_fallback tier
                pooled_tier[t] = True
            running = r
            basis = "corpus_ratio_isotonic" if pooled_tier[t] else \
                "corpus_ratio"
            bands[t] = {"warn_hi": _round(base * r, 1), "ratio": r,
                        "ratio_raw": ratio_raw[t], "basis": basis}
        else:
            implied = float(anchor.get(t, base)) / base
            r = implied if (running is None or implied >= running) else \
                running
            running = r
            bands[t] = {"warn_hi": _round(base * r, 1), "ratio": None,
                        "ratio_raw": None, "basis": "vocab_fallback"}
    return bands


def compute_stats(corpora, anchor):
    """Pure: corpora = {source: {license, entries:[...]}}; anchor =
    vocab dps_ceiling_warn. Returns the deterministic stats dict."""
    per_source = {}
    pooled_entries = []
    licenses = {}
    for source in sorted(corpora):
        doc = corpora[source]
        entries = doc.get("entries", []) or []
        per_source[source] = _stats_for_entries(entries)
        pooled_entries.extend(entries)
        licenses[source] = doc.get("license", "CC-BY-SA")
    pooled = _stats_for_entries(pooled_entries)
    ratio = _ratio_curve(pooled["metrics"])
    weights = {t: pooled["metrics"]["dps_proxy"][t]["n"] for t in TIERS}
    bands = _derive_bands(ratio, anchor, weights)
    pooled["rarity_ratio_dps"] = ratio
    return {
        "schema": SCHEMA,
        "sources": sorted(corpora),
        "licenses": dict(sorted(licenses.items())),
        "vocab_anchor": {k: anchor[k] for k in sorted(anchor)},
        "per_source": per_source,
        "pooled": pooled,
        "bands": bands,
        "bands_formula": (
            "ratio_raw[r] = corpus median dps-proxy of tier r divided by "
            "that of Common (None if tier r has no corpus dps data). ratio[r] "
            "= ratio_raw[r] isotonic (PAVA) clamped -- weighted by each "
            "tier's dps-proxy sample size n, pooling adjacent tiers into "
            "their weighted mean until the Common->Uncommon->Rare->Relic "
            "sequence is non-decreasing, with Common pinned fixed at 1.0 (a "
            "tier that would pool into Common's block is clamped to 1.0 "
            "instead of averaged with it); a tier with no corpus dps data "
            "falls back to vocab dps_ceiling_warn[r] (basis='vocab_fallback') "
            "but is still clamped into the same non-decreasing sequence. "
            "warn_hi[r] = round(vocab_anchor['Common'] * ratio[r], 1). basis "
            "is 'corpus_ratio_isotonic' for a corpus tier whose ratio changed "
            "from ratio_raw by clamping, 'corpus_ratio' for an untouched "
            "corpus tier, 'vocab_fallback' otherwise. dps-proxy = "
            "damage_mid / cadence_mid."
        ),
        "notes": (
            "REQ-0268 reference corpus. Numbers are derived statistics used to "
            "ground OUR balance curves; no source value is copied verbatim "
            "into live content. dps-proxy is only defined for entries carrying "
            "both a damage and a cadence (cooldown/every-secs) number."
        ),
    }


def canonical_json(obj):
    return json.dumps(obj, sort_keys=True, ensure_ascii=True, indent=2) + "\n"


def _load_corpora(norm_root, sources):
    corpora = {}
    for name in sources:
        path = os.path.join(norm_root, "%s.json" % name)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            corpora[name] = json.load(f)
    return corpora


def _fmt(v):
    return "-" if v is None else ("%g" % v)


def render_report(stats):
    lines = []
    lines.append("# Corpus stats report (REQ-0268)")
    lines.append("")
    lines.append("Reference-only genre corpus. Derived statistics ground OUR "
                 "balance curves; no source value is copied verbatim.")
    lines.append("")
    lines.append("Sources: " + ", ".join(stats["sources"]))
    lines.append("")
    # rarity distribution
    lines.append("## Rarity distribution")
    lines.append("")
    lines.append("| scope | " + " | ".join(TIERS) + " | unmapped | n |")
    lines.append("|" + "---|" * (len(TIERS) + 3))
    scopes = [("pooled", stats["pooled"])]
    for s in stats["sources"]:
        scopes.append((s, stats["per_source"][s]))
    for label, blk in scopes:
        d = blk["rarity_distribution"]
        row = [label] + [str(d.get(t, 0)) for t in TIERS]
        row += [str(d.get("unmapped", 0)), str(blk["n_entries"])]
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")
    # dps-proxy per rarity (pooled)
    lines.append("## Pooled dps-proxy by rarity (damage_mid / cadence_mid)")
    lines.append("")
    lines.append("| rarity | n | mean | median | p25 | p75 | p95 |")
    lines.append("|---|---|---|---|---|---|---|")
    dps = stats["pooled"]["metrics"]["dps_proxy"]
    for t in list(TIERS) + ["all"]:
        s = dps[t]
        lines.append("| %s | %s | %s | %s | %s | %s | %s |" % (
            t, s["n"], _fmt(s["mean"]), _fmt(s["median"]),
            _fmt(s["p25"]), _fmt(s["p75"]), _fmt(s["p95"])))
    lines.append("")
    # bands
    lines.append("## Derived dps warn bands (anchored to vocab dps_ceiling_warn)")
    lines.append("")
    lines.append("| rarity | ratio_raw | ratio | warn_hi | basis |")
    lines.append("|---|---|---|---|---|")
    for t in TIERS:
        b = stats["bands"][t]
        lines.append("| %s | %s | %s | %s | %s |" % (
            t, _fmt(b.get("ratio_raw")), _fmt(b["ratio"]), _fmt(b["warn_hi"]),
            b["basis"]))
    lines.append("")
    lines.append("Formula: " + stats["bands_formula"])
    lines.append("")
    # verb frequency (pooled)
    lines.append("## Pooled verb frequency (verbs_mapped)")
    lines.append("")
    vf = stats["pooled"]["verb_frequency"]
    if vf:
        lines.append("| verb | count |")
        lines.append("|---|---|")
        for verb, cnt in sorted(vf.items(), key=lambda kv: (-kv[1], kv[0])):
            lines.append("| %s | %d |" % (verb, cnt))
    else:
        lines.append("(none mapped)")
    lines.append("")
    return "\n".join(lines) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description="Derive corpus stat curves.")
    ap.add_argument("--norm", default=NORM_ROOT, help="normalized corpus root")
    ap.add_argument("--vocab", default=VOCAB_PATH, help="content/vocab.json")
    ap.add_argument("--stats-out", default=STATS_OUT,
                    help="tracked stats JSON output")
    ap.add_argument("--report-out", default=REPORT_OUT,
                    help="untracked markdown report output")
    ap.add_argument("--source", default="all",
                    help="restrict to one source (default all present)")
    args = ap.parse_args(argv)

    with open(args.vocab, encoding="utf-8") as f:
        vocab = json.load(f)
    anchor = vocab.get("dps_ceiling_warn", {})
    if not anchor:
        print("vocab has no dps_ceiling_warn anchor", file=sys.stderr)
        return 1

    if args.source == "all":
        sources = []
        if os.path.isdir(args.norm):
            for fn in sorted(os.listdir(args.norm)):
                if fn.endswith(".json"):
                    sources.append(fn[:-5])
    else:
        sources = [args.source]
    corpora = _load_corpora(args.norm, sources)
    if not corpora:
        print("no normalized corpora found under %s" % args.norm,
              file=sys.stderr)
        return 1

    stats = compute_stats(corpora, anchor)
    os.makedirs(os.path.dirname(args.stats_out), exist_ok=True)
    with open(args.stats_out, "w", encoding="utf-8") as f:
        f.write(canonical_json(stats))
    os.makedirs(os.path.dirname(args.report_out), exist_ok=True)
    with open(args.report_out, "w", encoding="utf-8") as f:
        f.write(render_report(stats))
    print("wrote %s (%d sources) and %s" %
          (args.stats_out, len(corpora), args.report_out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
