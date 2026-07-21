#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""REQ-0270 -- Corpus browser: dev-only static HTML view of the normalized
wiki corpus.

Stdlib only. Reads the normalized corpus (data/corpus/normalized/<source>.json),
the derived stats (content/corpus_stats.json) and OUR live content
(content/live/live_items.json + dungeon skills) and emits ONE self-contained
web/preview/corpus/index.html: inline CSS + JS, zero external asset requests,
works from file:// and the dev docroot. The dataset is embedded as a JSON blob.

The page tells one connected story across four views:
  1. ENTRIES            -- every normalized entry, searchable / sortable / filterable
  2. NORMALIZATION QUALITY -- per-source mapping quality + top unmapped phrases
  3. CURVES & BANDS     -- rarity distribution, dps-proxy box plots, verb freq, bands
  4. LIVE COMPARISON    -- OUR items/skills' dps-proxy vs the corpus bands

Determinism: no timestamps, stable ordering, sorted JSON keys -> two runs on
the same inputs are byte-identical.

The dps-proxy used for LIVE content is a faithful port of
tools/check_stat_bands.cjs (single source of meaning); parity is pinned by
tools/tests/corpus_browser_test.py. The corpus-side proxy (damage_mid /
cadence_mid) mirrors tools/corpus_stats.py.

Output is dev-only and UNTRACKED (web/preview/corpus/ is gitignored). Corpus
text is CC-BY-SA third-party reference data; the footer carries per-source
attribution.
"""
import argparse
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

TIERS = ("Common", "Uncommon", "Rare", "Relic")
# Damage-dealing verbs whose n is a hit magnitude -- parity with
# check_stat_bands.cjs DAMAGE_VERBS.
DAMAGE_VERBS = frozenset(("strike", "multi_strike", "charge_strike"))


# --------------------------------------------------------------------------
# Numeric ports (kept in exact parity with the source tools)
# --------------------------------------------------------------------------
def _mid(rng):
    """Midpoint of a [lo, hi] range. Parity with corpus_stats._mid and
    check_stat_bands mid() (incl. the NaN guard from the latter)."""
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
    """Linear-interpolation percentile (q in 0..100). Exact port of
    corpus_stats._percentile so box-plot numbers match corpus_stats.json."""
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


def _round(x, nd=3):
    if x is None:
        return None
    return round(float(x), nd) + 0.0


def corpus_entry_metrics(entry):
    """damage_mid / cadence_mid / dps_proxy / hp_mid / price_mid for one
    normalized entry. dps_proxy = damage_mid / cadence_mid (parity with
    corpus_stats._entry_metrics + the bands_formula)."""
    nums = entry.get("numbers", {}) or {}
    dmg = _mid(nums.get("damage"))
    cad = _mid(nums.get("cadence_secs"))
    hp = _mid(nums.get("hp"))
    price = _mid(nums.get("price"))
    armor = _mid(nums.get("armor"))
    heal = _mid(nums.get("heal"))
    dps = None
    if dmg is not None and cad is not None and cad > 0:
        dps = dmg / cad
    return {"damage_mid": dmg, "cadence_mid": cad, "dps_proxy": dps,
            "hp_mid": hp, "price_mid": price, "armor_mid": armor,
            "heal_mid": heal}


def live_def_dps(defn):
    """Summed damage dps-proxy of a live def. FAITHFUL port of
    check_stat_bands.cjs defDps(): SUM over effects of (verb.n mid /
    trigger.s mid) for effects that are BOTH a damage verb AND an every_secs
    trigger. Returns (dps, counted)."""
    dps = 0.0
    counted = 0
    effs = defn.get("effects")
    if isinstance(effs, list):
        pass
    elif defn.get("trigger") and defn.get("verb"):
        effs = [{"trigger": defn["trigger"], "verb": defn["verb"]}]
    else:
        effs = []
    for eff in effs:
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


def live_rarity_of(defn):
    """po/2 rarity is Capitalized; skill/1 has none. Port of
    check_stat_bands.cjs rarityOf()."""
    r = defn.get("rarity")
    if isinstance(r, str) and r:
        return r[0].upper() + r[1:].lower()
    return None


# --------------------------------------------------------------------------
# Data assembly
# --------------------------------------------------------------------------
def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def wiki_url_from_endpoint(endpoint):
    """https://x.fandom.com/api.php -> https://x.fandom.com/ (attribution link)."""
    if not endpoint:
        return None
    e = endpoint
    for suffix in ("/api.php", "/w/api.php", "api.php"):
        if e.endswith(suffix):
            e = e[: -len(suffix)]
            break
    if not e.endswith("/"):
        e += "/"
    return e


def build_entries(corpora):
    """Flatten every normalized entry into a display row, sorted (source, name,
    page) for stable output."""
    rows = []
    for src, doc in corpora:
        for e in doc.get("entries", []):
            m = corpus_entry_metrics(e)
            nums = e.get("numbers", {}) or {}
            unmapped = list(e.get("unmapped", []) or [])
            excluded = list(e.get("excluded", []) or [])
            rows.append({
                "source": src,
                "page": e.get("page"),
                "kind": e.get("kind"),
                "name": e.get("name") or e.get("page") or "",
                "rarity_raw": e.get("rarity_raw"),
                "rarity_norm": e.get("rarity_norm"),
                "damage": nums.get("damage"),
                "cadence_secs": nums.get("cadence_secs"),
                "hp": nums.get("hp"),
                "price": nums.get("price"),
                "armor": nums.get("armor"),
                "heal": nums.get("heal"),
                "damage_mid": _round(m["damage_mid"]),
                "cadence_mid": _round(m["cadence_mid"]),
                "dps_proxy": _round(m["dps_proxy"]),
                "hp_mid": _round(m["hp_mid"]),
                "price_mid": _round(m["price_mid"]),
                "effect_text": e.get("effect_text") or "",
                "verbs_mapped": list(e.get("verbs_mapped", []) or []),
                "unmapped": unmapped,
                "excluded": excluded,
                "tags": list(e.get("tags", []) or []),
                "has_unmapped": bool(unmapped),
                "has_excluded": bool(excluded),
            })
    rows.sort(key=lambda r: (r["source"], (r["name"] or "").lower(),
                             r["page"] or ""))
    return rows


def build_quality(corpora):
    """Per-source normalization-quality panel + pooled top unmapped phrases."""
    per_source = []
    phrase_counts = {}
    for src, doc in corpora:
        entries = doc.get("entries", [])
        kinds = {}
        rmap = {}  # (raw, norm) -> count
        verb_freq = {}
        mapped_tokens = 0
        unmapped_phrases = 0
        excluded_count = 0
        for e in entries:
            kinds[e.get("kind")] = kinds.get(e.get("kind"), 0) + 1
            key = (e.get("rarity_raw"), e.get("rarity_norm"))
            rmap[key] = rmap.get(key, 0) + 1
            for v in e.get("verbs_mapped", []) or []:
                verb_freq[v] = verb_freq.get(v, 0) + 1
                mapped_tokens += 1
            for u in e.get("unmapped", []) or []:
                unmapped_phrases += 1
                phrase_counts[u] = phrase_counts.get(u, 0) + 1
            excluded_count += len(e.get("excluded", []) or [])
        rarity_map = sorted(
            [{"raw": k[0], "norm": k[1], "count": c} for k, c in rmap.items()],
            key=lambda d: (-d["count"], str(d["raw"]), str(d["norm"])))
        per_source.append({
            "source": src,
            "license": doc.get("license"),
            "endpoint": doc.get("endpoint"),
            "fetch_date": doc.get("fetch_date"),
            "pages": len(entries),
            "n_entries": len(entries),
            "kinds": [{"kind": k, "count": c}
                      for k, c in sorted(kinds.items(),
                                         key=lambda kv: (-kv[1], str(kv[0])))],
            "rarity_map": rarity_map,
            "verb_frequency": [{"verb": v, "count": c}
                               for v, c in sorted(verb_freq.items(),
                                                  key=lambda kv: (-kv[1], kv[0]))],
            "mapped_tokens": mapped_tokens,
            "unmapped_phrases": unmapped_phrases,
            "excluded_count": excluded_count,
        })
    per_source.sort(key=lambda s: s["source"])
    top_unmapped = sorted(
        [{"phrase": p, "count": c} for p, c in phrase_counts.items()],
        key=lambda d: (-d["count"], d["phrase"]))[:20]
    return {"per_source": per_source, "top_unmapped": top_unmapped}


RARITIES_LC = ("common", "uncommon", "rare", "relic")


def _eb_group_row(key, grp):
    """One flat row for an enemy_bands group (hp / total_dps / skill_dps)."""
    grp = grp or {}
    band = grp.get("band") or {}
    row = {
        "key": key,
        "n": grp.get("n", 0),
        "provisional": grp.get("provisional"),
        "min": grp.get("min"),
        "median": grp.get("median"),
        "max": grp.get("max"),
        "warn_lo": band.get("warn_lo"),
        "warn_hi": band.get("warn_hi"),
        "flag_multiple": band.get("flag_multiple"),
    }
    if "n_na" in grp:
        row["n_na"] = grp["n_na"]
    return row


def _enemy_bands_view(eb):
    """Render content/enemy_bands.json (basis live_self) into browser tables.
    Absent file -> {present: False} (the section hides itself)."""
    if not eb:
        return {"present": False}
    hp = eb.get("enemy_hp", {})
    dps = eb.get("enemy_total_dps", {})
    skill = eb.get("skill_dps", {})
    return {
        "present": True,
        "basis": eb.get("basis"),
        "note": eb.get("note", ""),
        "band_formula": (eb.get("band_formula") or {}).get("description", ""),
        "hp_rows": [_eb_group_row(r, hp.get(r)) for r in RARITIES_LC],
        "dps_rows": [_eb_group_row(r, dps.get(r)) for r in RARITIES_LC],
        "skill_row": _eb_group_row("pooled", skill),
    }


def build_curves(corpora, stats, enemy_bands):
    """Rarity distribution, per-rarity dps-proxy box plots (min/p25/median/
    p75/p95/max) computed from raw entries with the corpus_stats method, verb
    frequency, and the bands table."""
    # Per-rarity dps-proxy values pooled across sources (same selection as
    # corpus_stats: entries with both damage and cadence).
    by_tier = {t: [] for t in TIERS}
    for _src, doc in corpora:
        for e in doc.get("entries", []):
            rn = e.get("rarity_norm")
            if rn not in TIERS:
                continue
            dps = corpus_entry_metrics(e)["dps_proxy"]
            if dps is not None:
                by_tier[rn].append(dps)
    box = []
    for t in TIERS:
        vals = sorted(by_tier[t])
        if not vals:
            box.append({"rarity": t, "n": 0})
            continue
        box.append({
            "rarity": t,
            "n": len(vals),
            "min": _round(vals[0]),
            "p25": _round(_percentile(vals, 25)),
            "median": _round(_percentile(vals, 50)),
            "p75": _round(_percentile(vals, 75)),
            "p95": _round(_percentile(vals, 95)),
            "max": _round(vals[-1]),
        })
    pooled = stats.get("pooled", {})
    dist = pooled.get("rarity_distribution", {})
    dist_rows = [{"rarity": t, "count": dist.get(t, 0)} for t in TIERS]
    dist_rows.append({"rarity": "unmapped", "count": dist.get("unmapped", 0)})
    verb_freq = pooled.get("verb_frequency", {})
    verb_rows = [{"verb": v, "count": c} for v, c in
                 sorted(verb_freq.items(), key=lambda kv: (-kv[1], kv[0]))]
    bands = stats.get("bands", {})
    band_rows = []
    for t in TIERS:
        b = bands.get(t)
        if not b:
            continue
        band_rows.append({
            "rarity": t,
            "ratio_raw": b.get("ratio_raw"),
            "ratio": b.get("ratio"),
            "warn_hi": b.get("warn_hi"),
            "basis": b.get("basis"),
        })
    return {
        "rarity_distribution": dist_rows,
        "dps_box": box,
        "verb_frequency": verb_rows,
        "bands": band_rows,
        "bands_scope": stats.get("bands_scope", "item"),
        "bands_formula": stats.get("bands_formula", ""),
        "vocab_anchor": stats.get("vocab_anchor", {}),
        "enemy_bands": _enemy_bands_view(enemy_bands),
    }


def build_live(live_docs, item_bands, enemy_bands):
    """Every live item/skill with a computable dps-proxy vs the band that
    applies to it, WITH scope labels (REQ-0275): items -> their rarity's
    ITEM-scope corpus band (content/corpus_stats.json, bands_scope=item);
    skills -> the pooled live_self skill-dps band (content/enemy_bands.json).
    Faithful port of check_stat_bands.cjs dps-proxy (counted==0 skipped)."""
    rows = []
    skill_band = ((enemy_bands or {}).get("skill_dps") or {}).get("band") or None
    for kind, doc in live_docs:
        entries = doc.get("entries") or doc.get("skills") or []
        for d in entries:
            dps, counted = live_def_dps(d)
            if counted == 0:
                continue  # no damage-tick effect: nothing to say (parity)
            rarity = live_rarity_of(d)
            if kind == "skill":
                band = skill_band
                scope = "skill"
                basis = "live_self"
                flag_mult = (band or {}).get("flag_multiple", 2)
            else:
                band = item_bands.get(rarity) if rarity else None
                scope = "item"
                basis = band.get("basis") if band else None
                flag_mult = 3  # item bands have no flag_multiple: keep >3x rule
            warn_hi = band.get("warn_hi") if band else None
            status = "na"
            ratio = None
            severe = False
            if isinstance(warn_hi, (int, float)) and warn_hi > 0:
                ratio = dps / warn_hi
                status = "OVER" if dps > warn_hi else "OK"
                severe = dps > flag_mult * warn_hi
            rows.append({
                "kind": kind,
                "id": d.get("id") or d.get("name") or "(anon)",
                "name": d.get("name") or d.get("name_en") or d.get("id") or "",
                "rarity": rarity,
                "scope": scope,
                "basis": basis,
                "dps": _round(dps),
                "counted": counted,
                "warn_hi": warn_hi,
                "ratio": _round(ratio) if ratio is not None else None,
                "status": status,
                "severe": severe,
            })
    # Deterministic: banded items first (by descending ratio), then na (skills)
    # by descending dps.
    def sort_key(r):
        has_band = 0 if r["status"] != "na" else 1
        primary = -(r["ratio"] if r["ratio"] is not None else -1)
        return (has_band, primary, -(r["dps"] or 0), r["id"])
    rows.sort(key=sort_key)
    summary = {
        "evaluated": len(rows),
        "over": sum(1 for r in rows if r["status"] == "OVER"),
        "severe": sum(1 for r in rows if r["severe"]),
        "ok": sum(1 for r in rows if r["status"] == "OK"),
        "na": sum(1 for r in rows if r["status"] == "na"),
    }
    return {"rows": rows, "summary": summary}


def build_dataset(data_dir, stats_path, live_specs, enemy_bands_path=None):
    norm_dir = os.path.join(data_dir, "normalized")
    corpora = []
    for fn in sorted(os.listdir(norm_dir)):
        if not fn.endswith(".json"):
            continue
        doc = load_json(os.path.join(norm_dir, fn))
        corpora.append((doc.get("source") or fn[:-5], doc))
    corpora.sort(key=lambda sd: sd[0])

    stats = load_json(stats_path)
    bands = stats.get("bands", {})
    enemy_bands = None
    if enemy_bands_path and os.path.exists(enemy_bands_path):
        enemy_bands = load_json(enemy_bands_path)

    live_docs = []
    for kind, path in live_specs:
        if path and os.path.exists(path):
            live_docs.append((kind, load_json(path)))

    entries = build_entries(corpora)
    quality = build_quality(corpora)
    curves = build_curves(corpora, stats, enemy_bands)
    live = build_live(live_docs, bands, enemy_bands)

    attribution = []
    for src, doc in corpora:
        attribution.append({
            "source": src,
            "license": doc.get("license") or stats.get("licenses", {}).get(src),
            "url": wiki_url_from_endpoint(doc.get("endpoint")),
            "fetch_date": doc.get("fetch_date"),
        })
    attribution.sort(key=lambda a: a["source"])

    return {
        "meta": {
            "tool": "tools/build_corpus_browser.py",
            "req": "REQ-0270",
            "note": "dev-only, untracked",
            "total_entries": len(entries),
            "sources": [s for s, _ in corpora],
        },
        "entries": entries,
        "quality": quality,
        "curves": curves,
        "live": live,
        "attribution": attribution,
        "notes": stats.get("notes", ""),
    }


# --------------------------------------------------------------------------
# Static assets (inline; no external requests)
# --------------------------------------------------------------------------
CSS = """
:root{--bg:#12161c;--panel:#1a2029;--panel2:#212936;--edge:#2c3542;
--fg:#dfe6ee;--mut:#8b98a8;--acc:#6ab7ff;--ok:#57c98a;--warn:#e8a13a;
--over:#e5533a;--severe:#b71c1c;--chip:#2a3543;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:13px/1.45 system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
h1{font-size:18px;margin:0}
h2{font-size:15px;margin:0 0 8px;color:var(--acc)}
h3{font-size:13px;margin:0 0 6px;color:var(--fg)}
a{color:var(--acc)}
header{padding:12px 16px;border-bottom:1px solid var(--edge);
display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
header .sub{color:var(--mut);font-size:12px}
nav{display:flex;gap:2px;padding:8px 16px 0;border-bottom:1px solid var(--edge);
flex-wrap:wrap}
nav button{background:var(--panel);color:var(--mut);border:1px solid var(--edge);
border-bottom:none;padding:7px 14px;cursor:pointer;font-size:13px;
border-radius:6px 6px 0 0}
nav button.active{background:var(--panel2);color:var(--fg);font-weight:600}
main{padding:14px 16px 40px}
.view{display:none}
.view.active{display:block}
.controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.controls input[type=text]{background:var(--panel);border:1px solid var(--edge);
color:var(--fg);padding:6px 9px;border-radius:5px;min-width:230px}
.controls select{background:var(--panel);border:1px solid var(--edge);
color:var(--fg);padding:5px 7px;border-radius:5px}
.controls label{color:var(--mut);display:flex;align-items:center;gap:4px}
.count{color:var(--mut);margin-left:auto}
table{border-collapse:collapse;width:100%;font-size:12.5px}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--edge);
vertical-align:top}
th{position:sticky;top:0;background:var(--panel2);cursor:pointer;
white-space:nowrap;user-select:none}
th.sorted::after{content:" \\25B2";color:var(--acc)}
th.sorted.desc::after{content:" \\25BC";color:var(--acc)}
td.num{text-align:right;font-variant-numeric:tabular-nums}
tr.row{cursor:pointer}
tr.row:hover{background:var(--panel)}
tr.detail>td{background:#0e1319;border-bottom:2px solid var(--edge)}
.detail-box{display:grid;grid-template-columns:1fr;gap:8px;padding:4px 2px}
.kv{color:var(--mut)}
.kv b{color:var(--fg);font-weight:600}
.chips{display:flex;gap:5px;flex-wrap:wrap;margin-top:3px}
.chip{padding:2px 8px;border-radius:10px;font-size:11.5px;background:var(--chip);
border:1px solid var(--edge)}
.chip.map{background:#183527;border-color:#2b6a49;color:#9fe6be}
.chip.un{background:#3a3115;border-color:#7a6320;color:#f0cf87}
.chip.ex{background:#2a2f38;border-color:#454f5c;color:#b7c2d0}
.chip.tag{background:#1c2733;border-color:#33465a;color:#a9c6e2}
.badge{padding:1px 7px;border-radius:4px;font-size:11px;font-weight:600}
.badge.Common{background:#2a3138;color:#c6d2de}
.badge.Uncommon{background:#1f3a2b;color:#8fe3b0}
.badge.Rare{background:#1e2f47;color:#8fb8f0}
.badge.Relic{background:#3a2140;color:#e4a6f0}
.badge.unmapped{background:#3a2a15;color:#e6bf85}
.badge.item{background:#22303c;color:#9fd0e8}
.badge.skill{background:#2c2740;color:#c3aef0}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--edge);border-radius:8px;
padding:12px 14px}
.card .lic{color:var(--mut);font-size:11.5px}
.q-row{display:flex;justify-content:space-between;border-bottom:1px dotted var(--edge);
padding:3px 0}
.q-big{display:flex;gap:16px;margin:8px 0}
.q-stat{text-align:center}
.q-stat .v{font-size:20px;font-weight:700}
.q-stat .l{color:var(--mut);font-size:11px}
.bar{height:14px;background:var(--acc);border-radius:2px}
.barrow{display:grid;grid-template-columns:120px 1fr 46px;gap:8px;align-items:center;
margin:2px 0}
.barrow .lab{color:var(--mut);text-align:right;font-size:12px}
.barrow .val{font-variant-numeric:tabular-nums}
.mut{color:var(--mut)}
.section{background:var(--panel);border:1px solid var(--edge);border-radius:8px;
padding:14px;margin-bottom:14px}
.formula{background:#0e1319;border:1px solid var(--edge);border-radius:6px;
padding:10px;color:var(--mut);font-size:12px;white-space:pre-wrap}
.link{color:var(--acc);cursor:pointer;text-decoration:underline}
.live-row{display:grid;grid-template-columns:210px 84px 66px 1fr 60px;gap:10px;
align-items:center;padding:4px 0;border-bottom:1px solid var(--edge)}
.live-row .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.track{position:relative;height:16px;background:var(--panel2);border-radius:3px;
overflow:hidden}
.track .fill{position:absolute;left:0;top:0;bottom:0;background:var(--ok);opacity:.85}
.track.OVER .fill{background:var(--over)}
.track.severe .fill{background:var(--severe)}
.track .band{position:absolute;top:-2px;bottom:-2px;width:2px;background:#fff;opacity:.8}
.track.na{background:#1b222b}
.stat-over{color:var(--over);font-weight:700}
.stat-ok{color:var(--ok)}
.stat-na{color:var(--mut)}
.summary{display:flex;gap:18px;margin-bottom:12px;flex-wrap:wrap}
.summary .s{background:var(--panel2);border:1px solid var(--edge);border-radius:6px;
padding:8px 14px;text-align:center}
.summary .s .v{font-size:22px;font-weight:700}
.summary .s .l{color:var(--mut);font-size:11px}
footer{padding:14px 16px;border-top:1px solid var(--edge);color:var(--mut);
font-size:11.5px}
.box-plot{margin:3px 0}
"""

JS = """
'use strict';
var D = JSON.parse(document.getElementById('corpus-data').textContent);
var $ = function(s,r){return (r||document).querySelector(s);};
var el = function(tag,cls,txt){var e=document.createElement(tag);
if(cls)e.className=cls; if(txt!=null)e.textContent=txt; return e;};
function num(x,d){if(x===null||x===undefined)return '\\u2014';
var v=Number(x); return (d===undefined)? String(v): v.toFixed(d);}

/* ---- tab switching ---- */
function showView(id){
  var vs=document.querySelectorAll('.view');
  for(var i=0;i<vs.length;i++)vs[i].classList.toggle('active',vs[i].id===id);
  var bs=document.querySelectorAll('nav button');
  for(var j=0;j<bs.length;j++)bs[j].classList.toggle('active',bs[j].dataset.view===id);
}

/* ============================ ENTRIES ============================ */
var ES={q:'',source:'',kind:'',rarity:'',un:false,ex:false,sort:'name',dir:1};
var RANK={Common:0,Uncommon:1,Rare:2,Relic:3};
function rarityRank(r){return (r in RANK)?RANK[r]:99;}
function entryVal(e,k){
  if(k==='name')return (e.name||'').toLowerCase();
  if(k==='source')return e.source;
  if(k==='kind')return e.kind||'';
  if(k==='rarity')return rarityRank(e.rarity_norm);
  if(k==='damage')return e.damage_mid;
  if(k==='cadence')return e.cadence_mid;
  if(k==='dps')return e.dps_proxy;
  if(k==='hp')return e.hp_mid;
  if(k==='price')return e.price_mid;
  return '';
}
function cmp(a,b,dir){
  var na=(a===null||a===undefined),nb=(b===null||b===undefined);
  if(na&&nb)return 0; if(na)return 1; if(nb)return -1;  /* nulls last */
  if(a<b)return -1*dir; if(a>b)return 1*dir; return 0;
}
function matchEntry(e){
  if(ES.source&&e.source!==ES.source)return false;
  if(ES.kind&&e.kind!==ES.kind)return false;
  if(ES.rarity){var rn=e.rarity_norm||'unmapped'; if(rn!==ES.rarity)return false;}
  if(ES.un&&!e.has_unmapped)return false;
  if(ES.ex&&!e.has_excluded)return false;
  if(ES.q){
    var q=ES.q.toLowerCase();
    var hay=[e.name,e.page,e.effect_text,(e.verbs_mapped||[]).join(' '),
      (e.unmapped||[]).join(' '),(e.excluded||[]).join(' '),
      (e.tags||[]).join(' '),e.rarity_raw].join(' ').toLowerCase();
    if(hay.indexOf(q)<0)return false;
  }
  return true;
}
var COLS=[['name','name'],['source','source'],['kind','kind'],
 ['rarity','rarity_norm'],['dmg-mid','damage'],['cad-mid','cadence'],
 ['dps-proxy','dps'],['hp','hp'],['price','price']];
function chipList(arr,cls){var w=el('span','chips');
  for(var i=0;i<arr.length;i++)w.appendChild(el('span','chip '+cls,arr[i]));
  return w;}
function detailRow(e,ncols){
  var tr=el('tr','detail'); var td=el('td'); td.colSpan=ncols;
  var box=el('div','detail-box');
  var eff=el('div','kv'); eff.innerHTML='<b>effect_text:</b> ';
  eff.appendChild(document.createTextNode(e.effect_text||'\\u2014'));
  box.appendChild(eff);
  var raw=el('div','kv');
  raw.innerHTML='<b>raw numbers:</b> damage='+JSON.stringify(e.damage)
   +'  cadence_secs='+JSON.stringify(e.cadence_secs)+'  hp='+JSON.stringify(e.hp)
   +'  price='+JSON.stringify(e.price)+'  armor='+JSON.stringify(e.armor)
   +'  heal='+JSON.stringify(e.heal);
  box.appendChild(raw);
  if(e.verbs_mapped.length){var r=el('div','kv');r.innerHTML='<b>verbs_mapped</b>';
    r.appendChild(chipList(e.verbs_mapped,'map'));box.appendChild(r);}
  if(e.unmapped.length){var r2=el('div','kv');r2.innerHTML='<b>unmapped</b>';
    r2.appendChild(chipList(e.unmapped,'un'));box.appendChild(r2);}
  if(e.excluded.length){var r3=el('div','kv');r3.innerHTML='<b>excluded</b>';
    r3.appendChild(chipList(e.excluded,'ex'));box.appendChild(r3);}
  if(e.tags.length){var r4=el('div','kv');r4.innerHTML='<b>tags</b>';
    r4.appendChild(chipList(e.tags,'tag'));box.appendChild(r4);}
  td.appendChild(box); tr.appendChild(td); return tr;
}
function renderEntries(){
  var rows=D.entries.filter(matchEntry);
  rows.sort(function(a,b){
    var v=cmp(entryVal(a,ES.sort),entryVal(b,ES.sort),ES.dir);
    if(v!==0)return v; return cmp((a.name||'').toLowerCase(),(b.name||'').toLowerCase(),1);
  });
  $('#e-count').textContent=rows.length+' / '+D.entries.length+' entries';
  var tb=$('#e-body'); tb.textContent='';
  for(var i=0;i<rows.length;i++){
    var e=rows[i];
    var tr=el('tr','row');
    tr.appendChild(el('td',null,e.name));
    tr.appendChild(el('td',null,e.source));
    tr.appendChild(el('td',null,e.kind||''));
    var rd=el('td'); var rn=e.rarity_norm||'unmapped';
    var b=el('span','badge '+rn,e.rarity_norm||('unmapped'+(e.rarity_raw?' ('+e.rarity_raw+')':'')));
    if(e.rarity_norm&&e.rarity_raw&&e.rarity_raw!==e.rarity_norm)
      {b.title='raw: '+e.rarity_raw;}
    rd.appendChild(b); tr.appendChild(rd);
    tr.appendChild(el('td','num',num(e.damage_mid)));
    tr.appendChild(el('td','num',num(e.cadence_mid)));
    tr.appendChild(el('td','num',e.dps_proxy==null?'\\u2014':num(e.dps_proxy,2)));
    tr.appendChild(el('td','num',num(e.hp_mid)));
    tr.appendChild(el('td','num',num(e.price_mid)));
    (function(en,row){row.addEventListener('click',function(){
      var nx=row.nextSibling;
      if(nx&&nx.classList&&nx.classList.contains('detail')){nx.parentNode.removeChild(nx);}
      else{row.parentNode.insertBefore(detailRow(en,COLS.length),row.nextSibling);}
    });})(e,tr);
    tb.appendChild(tr);
  }
}
function buildEntriesControls(){
  var srcs={},kinds={};
  D.entries.forEach(function(e){srcs[e.source]=1;if(e.kind)kinds[e.kind]=1;});
  fillSelect('#f-source',Object.keys(srcs).sort(),'all sources');
  fillSelect('#f-kind',Object.keys(kinds).sort(),'all kinds');
  fillSelect('#f-rarity',['Common','Uncommon','Rare','Relic','unmapped'],'all rarities');
  $('#f-search').addEventListener('input',function(){ES.q=this.value;renderEntries();});
  $('#f-source').addEventListener('change',function(){ES.source=this.value;renderEntries();});
  $('#f-kind').addEventListener('change',function(){ES.kind=this.value;renderEntries();});
  $('#f-rarity').addEventListener('change',function(){ES.rarity=this.value;renderEntries();});
  $('#f-un').addEventListener('change',function(){ES.un=this.checked;renderEntries();});
  $('#f-ex').addEventListener('change',function(){ES.ex=this.checked;renderEntries();});
  var thead=$('#e-head');
  COLS.forEach(function(c){
    var th=el('th',null,c[0]); th.dataset.key=c[1];
    if(c[1]==='name'||c[1]==='source'||c[1]==='kind')th.classList.remove('num');
    th.addEventListener('click',function(){
      if(ES.sort===c[1])ES.dir*=-1; else{ES.sort=c[1];ES.dir=1;}
      var ths=thead.querySelectorAll('th');
      ths.forEach(function(t){t.classList.remove('sorted','desc');});
      th.classList.add('sorted'); if(ES.dir<0)th.classList.add('desc');
      renderEntries();
    });
    if(c[1]==='name')th.classList.add('sorted');
    thead.appendChild(th);
  });
}
function fillSelect(sel,opts,allLabel){
  var s=$(sel); s.appendChild(new Option(allLabel,''));
  opts.forEach(function(o){s.appendChild(new Option(o,o));});
}
function filterByPhrase(p){
  ES.q=p; $('#f-search').value=p; showView('view-entries'); renderEntries();
}

/* ==================== NORMALIZATION QUALITY ==================== */
function renderQuality(){
  var wrap=$('#q-cards'); wrap.textContent='';
  D.quality.per_source.forEach(function(s){
    var c=el('div','card');
    c.appendChild(el('h3',null,s.source));
    var lic=el('div','lic',(s.license||'')+'  \\u00b7  '+s.pages+' pages  \\u00b7  fetched '+(s.fetch_date||'?'));
    c.appendChild(lic);
    var big=el('div','q-big');
    big.appendChild(qstat(s.mapped_tokens,'mapped verb tokens'));
    big.appendChild(qstat(s.unmapped_phrases,'unmapped phrases'));
    big.appendChild(qstat(s.excluded_count,'excluded features'));
    c.appendChild(big);
    c.appendChild(el('div','kv','kinds')).style.marginTop='4px';
    s.kinds.forEach(function(k){c.appendChild(qrow(k.kind+'','\\u00d7'+k.count));});
    var rh=el('div','kv','rarity mapping (raw \\u2192 norm)'); rh.style.marginTop='6px';
    c.appendChild(rh);
    s.rarity_map.forEach(function(r){
      c.appendChild(qrow((r.raw==null?'(none)':r.raw)+' \\u2192 '+(r.norm==null?'(unmapped)':r.norm),'\\u00d7'+r.count));
    });
    if(s.verb_frequency.length){
      var vh=el('div','kv','mapped verb frequency'); vh.style.marginTop='6px';
      c.appendChild(vh);
      var mx=Math.max.apply(null,s.verb_frequency.map(function(v){return v.count;}));
      s.verb_frequency.forEach(function(v){c.appendChild(barRow(v.verb,v.count,mx));});
    }
    wrap.appendChild(c);
  });
  var tu=$('#q-unmapped'); tu.textContent='';
  D.quality.top_unmapped.forEach(function(u){
    var row=el('div','q-row');
    var a=el('span','link',u.phrase);
    a.addEventListener('click',function(){filterByPhrase(u.phrase);});
    row.appendChild(a); row.appendChild(el('span','mut','\\u00d7'+u.count));
    tu.appendChild(row);
  });
}
function qstat(v,l){var d=el('div','q-stat');d.appendChild(el('div','v',String(v)));
  d.appendChild(el('div','l',l));return d;}
function qrow(l,v){var r=el('div','q-row');r.appendChild(el('span',null,l));
  r.appendChild(el('span','mut',v));return r;}
function barRow(lab,val,mx){
  var r=el('div','barrow'); r.appendChild(el('div','lab',lab));
  var track=el('div'); var bar=el('div','bar');
  bar.style.width=(mx>0?Math.max(2,100*val/mx):0)+'%'; track.appendChild(bar);
  r.appendChild(track); r.appendChild(el('div','val',String(val))); return r;
}

/* ==================== CURVES & BANDS ==================== */
function fillEbTable(tb, rows, isSkill){
  if(!tb) return; tb.textContent='';
  (rows||[]).forEach(function(r){
    var tr=el('tr');
    tr.appendChild(el('td',null,r.key));
    var nlab=String(r.n)+((isSkill&&r.n_na!=null)?(' (+'+r.n_na+' na)'):'');
    tr.appendChild(el('td','num',nlab));
    tr.appendChild(el('td',null,r.provisional?'yes':'no'));
    tr.appendChild(el('td','num',num(r.min,2)));
    tr.appendChild(el('td','num',num(r.median,2)));
    tr.appendChild(el('td','num',num(r.max,2)));
    tr.appendChild(el('td','num',num(r.warn_lo,2)));
    tr.appendChild(el('td','num',num(r.warn_hi,2)));
    tr.appendChild(el('td','num',num(r.flag_multiple,1)));
    tb.appendChild(tr);
  });
}
function renderCurves(){
  var C=D.curves;
  var rd=$('#c-dist'); rd.textContent='';
  var mx=Math.max.apply(null,C.rarity_distribution.map(function(d){return d.count;}));
  C.rarity_distribution.forEach(function(d){rd.appendChild(barRow(d.rarity,d.count,mx));});
  /* box plots */
  var bp=$('#c-box'); bp.textContent='';
  var scaleMax=0;
  C.dps_box.forEach(function(b){if(b.n>0)scaleMax=Math.max(scaleMax,b.max);});
  scaleMax=scaleMax||1;
  C.dps_box.forEach(function(b){
    var row=el('div','barrow'); row.style.gridTemplateColumns='120px 1fr 150px';
    row.appendChild(el('div','lab',b.rarity+' (n='+(b.n||0)+')'));
    var cell=el('div');
    if(b.n>0)cell.innerHTML=boxSVG(b,scaleMax); else cell.appendChild(el('span','mut','no dps data'));
    row.appendChild(cell);
    var lab= (b.n>0)?('med '+num(b.median,2)+'  p95 '+num(b.p95,2)):'';
    row.appendChild(el('div','val',lab));
    bp.appendChild(row);
  });
  /* verb frequency pooled */
  var vf=$('#c-verbs'); vf.textContent='';
  var vmx=Math.max.apply(null,C.verb_frequency.map(function(v){return v.count;})||[1]);
  C.verb_frequency.forEach(function(v){vf.appendChild(barRow(v.verb,v.count,vmx));});
  /* bands table */
  var bt=$('#c-bands tbody'); bt.textContent='';
  C.bands.forEach(function(b){
    var tr=el('tr');
    tr.appendChild(el('td',null,b.rarity));
    tr.appendChild(el('td','num',num(b.ratio_raw,3)));
    tr.appendChild(el('td','num',num(b.ratio,3)));
    tr.appendChild(el('td','num',num(b.warn_hi,1)));
    tr.appendChild(el('td',null,b.basis));
    bt.appendChild(tr);
  });
  $('#c-formula').textContent=C.bands_formula;
  /* scope label on the corpus (item-scope) bands */
  var cs=$('#c-bands-scope'); if(cs) cs.textContent='(scope: '+(C.bands_scope||'item')+' \u2014 corpus-derived)';
  /* enemy-side bands (basis live_self, from content/enemy_bands.json) */
  var EB=C.enemy_bands||{present:false};
  var ebsec=$('#c-enemy-bands');
  if(ebsec){
    if(!EB.present){ ebsec.style.display='none'; }
    else{
      ebsec.style.display='';
      $('#eb-note').textContent=EB.note||'';
      $('#eb-formula').textContent=EB.band_formula||'';
      fillEbTable($('#c-eb-hp tbody'), EB.hp_rows, false);
      fillEbTable($('#c-eb-dps tbody'), EB.dps_rows, false);
      fillEbTable($('#c-eb-skill tbody'), [EB.skill_row], true);
    }
  }
}
function boxSVG(b,scaleMax){
  var W=100,H=18,pad=1; /* percent-based via viewBox */
  function x(v){return pad+(W-2*pad)*(v/scaleMax);}
  var y=H/2;
  var wl=x(b.min),wr=x(b.max),q1=x(b.p25),q3=x(b.p75),md=x(b.median);
  var s='<svg class="box-plot" viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'" preserveAspectRatio="none">';
  s+='<line x1="'+wl+'" y1="'+y+'" x2="'+wr+'" y2="'+y+'" stroke="#8b98a8" stroke-width="0.6"/>';
  s+='<line x1="'+wl+'" y1="'+(y-4)+'" x2="'+wl+'" y2="'+(y+4)+'" stroke="#8b98a8" stroke-width="0.6"/>';
  s+='<line x1="'+wr+'" y1="'+(y-4)+'" x2="'+wr+'" y2="'+(y+4)+'" stroke="#8b98a8" stroke-width="0.6"/>';
  s+='<rect x="'+q1+'" y="'+(y-5)+'" width="'+(q3-q1)+'" height="10" fill="#1e2f47" stroke="#6ab7ff" stroke-width="0.6"/>';
  s+='<line x1="'+md+'" y1="'+(y-5)+'" x2="'+md+'" y2="'+(y+5)+'" stroke="#e8a13a" stroke-width="1"/>';
  s+='</svg>';
  return s;
}

/* ==================== LIVE COMPARISON ==================== */
function renderLive(){
  var L=D.live;
  var sm=$('#l-summary'); sm.textContent='';
  [['evaluated','evaluated'],['over','over band'],['severe','\\u22653\\u00d7 band'],
   ['ok','in band'],['na','no rarity band']].forEach(function(p){
    var d=el('div','s'); d.appendChild(el('div','v',String(L.summary[p[0]])));
    d.appendChild(el('div','l',p[1])); sm.appendChild(d);
  });
  var scaleMax=0;
  L.rows.forEach(function(r){
    var top=r.warn_hi?Math.max(r.dps,r.warn_hi):r.dps;
    scaleMax=Math.max(scaleMax,top);
  });
  scaleMax=scaleMax||1;
  var body=$('#l-body'); body.textContent='';
  L.rows.forEach(function(r){
    var row=el('div','live-row');
    var nm=el('div','name'); nm.appendChild(el('span','badge '+r.kind,r.kind));
    nm.appendChild(document.createTextNode(' '+r.name));
    nm.appendChild(el('span','mut',' ['+r.scope+(r.basis?('/'+r.basis):'')+']'));
    row.appendChild(nm);
    row.appendChild(el('div',null,r.rarity||'\\u2014'));
    row.appendChild(el('div','num','dps '+num(r.dps,2)));
    var tk=el('div','track '+(r.severe?'severe ':'')+(r.status==='na'?'na':r.status));
    var fill=el('div','fill'); fill.style.width=(100*r.dps/scaleMax)+'%'; tk.appendChild(fill);
    if(r.warn_hi){var band=el('div','band'); band.style.left=(100*r.warn_hi/scaleMax)+'%';
      band.title='warn_hi '+r.warn_hi; tk.appendChild(band);}
    row.appendChild(tk);
    var st=el('div');
    if(r.status==='OVER'){st.className='stat-over';st.textContent=(r.severe?'OVER\\u00d7'+num(r.ratio,1):'OVER '+num(r.ratio,2));}
    else if(r.status==='OK'){st.className='stat-ok';st.textContent='OK '+num(r.ratio,2);}
    else{st.className='stat-na';st.textContent='na';}
    row.appendChild(st);
    body.appendChild(row);
  });
}

/* ==================== FOOTER ==================== */
function renderFooter(){
  var f=$('#foot-attrib'); f.textContent='';
  D.attribution.forEach(function(a){
    var span=el('span');
    span.appendChild(document.createTextNode(a.source+' ('+(a.license||'?')+') '));
    if(a.url){var link=el('a',null,a.url); link.href=a.url; link.target='_blank';
      link.rel='noopener'; span.appendChild(link);}
    span.appendChild(document.createTextNode('  \\u00b7  '));
    f.appendChild(span);
  });
}

/* ==================== boot ==================== */
document.querySelectorAll('nav button').forEach(function(b){
  b.addEventListener('click',function(){showView(b.dataset.view);});
});
buildEntriesControls();
renderEntries();
renderQuality();
renderCurves();
renderLive();
renderFooter();
showView('view-entries');
"""


# --------------------------------------------------------------------------
# HTML assembly
# --------------------------------------------------------------------------
def _esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;"))


def build_html(dataset):
    data_json = json.dumps(dataset, sort_keys=True, ensure_ascii=True,
                           separators=(",", ":"))
    # Prevent the JSON blob from prematurely closing the <script> element.
    data_json = data_json.replace("</", "<\\/")
    meta = dataset["meta"]
    total = meta["total_entries"]
    srcs = ", ".join(meta["sources"])
    body = """
<header>
  <h1>Corpus Browser</h1>
  <span class="sub">REQ-0270 &middot; __TOTAL__ normalized entries &middot; sources: __SRCS__ &middot; dev-only, untracked</span>
</header>
<nav>
  <button data-view="view-entries" class="active">Entries</button>
  <button data-view="view-quality">Normalization Quality</button>
  <button data-view="view-curves">Curves &amp; Bands</button>
  <button data-view="view-live">Live Comparison</button>
</nav>
<main>
  <section id="view-entries" class="view active">
    <div class="controls">
      <input type="text" id="f-search" placeholder="search name / effect / verbs / phrases..."/>
      <select id="f-source"></select>
      <select id="f-kind"></select>
      <select id="f-rarity"></select>
      <label><input type="checkbox" id="f-un"/> has unmapped</label>
      <label><input type="checkbox" id="f-ex"/> has excluded</label>
      <span class="count" id="e-count"></span>
    </div>
    <table><thead><tr id="e-head"></tr></thead><tbody id="e-body"></tbody></table>
  </section>

  <section id="view-quality" class="view">
    <h2>Can we trust the corpus?</h2>
    <p class="mut">Per-source classification, rarity mapping and verb-mapping coverage; the top unmapped phrases (click one to filter Entries).</p>
    <div class="cards" id="q-cards"></div>
    <div class="section" style="margin-top:14px">
      <h3>Top 20 unmapped phrases (pooled)</h3>
      <div id="q-unmapped"></div>
    </div>
  </section>

  <section id="view-curves" class="view">
    <div class="section"><h2>Rarity distribution (pooled)</h2><div id="c-dist"></div></div>
    <div class="section"><h2>dps-proxy spread by rarity</h2>
      <p class="mut">Corpus dps-proxy = damage_mid / cadence_mid. Box = p25..p75, orange line = median, whiskers = min..max.</p>
      <div id="c-box"></div></div>
    <div class="section"><h2>Verb frequency (pooled)</h2><div id="c-verbs"></div></div>
    <div class="section"><h2>Derived bands <span class="mut" id="c-bands-scope"></span></h2>
      <table id="c-bands"><thead><tr><th>rarity</th><th class="num">ratio_raw</th>
        <th class="num">ratio (isotonic)</th><th class="num">warn_hi</th><th>basis</th></tr></thead>
        <tbody></tbody></table>
      <h3 style="margin-top:10px">bands_formula</h3>
      <div class="formula" id="c-formula"></div></div>
    <div class="section" id="c-enemy-bands"><h2>Enemy-side bands <span class="mut">(scope: live_self &mdash; our current live meta, not genre truth)</span></h2>
      <p class="mut" id="eb-note"></p>
      <h3 style="margin-top:8px">Enemy HP by rarity (over hp midpoints)</h3>
      <table id="c-eb-hp"><thead><tr><th>rarity</th><th class="num">n</th><th>prov</th><th class="num">min</th><th class="num">median</th><th class="num">max</th><th class="num">warn_lo</th><th class="num">warn_hi</th><th class="num">flag&times;</th></tr></thead><tbody></tbody></table>
      <h3 style="margin-top:12px">Enemy total-dps by rarity (sum of the enemy's skill dps-proxies)</h3>
      <table id="c-eb-dps"><thead><tr><th>rarity</th><th class="num">n</th><th>prov</th><th class="num">min</th><th class="num">median</th><th class="num">max</th><th class="num">warn_lo</th><th class="num">warn_hi</th><th class="num">flag&times;</th></tr></thead><tbody></tbody></table>
      <h3 style="margin-top:12px">Skill dps (pooled &mdash; skill/1 carries no rarity)</h3>
      <table id="c-eb-skill"><thead><tr><th>group</th><th class="num">n</th><th>prov</th><th class="num">min</th><th class="num">median</th><th class="num">max</th><th class="num">warn_lo</th><th class="num">warn_hi</th><th class="num">flag&times;</th></tr></thead><tbody></tbody></table>
      <h3 style="margin-top:12px">band_formula</h3>
      <div class="formula" id="eb-formula"></div></div>
  </section>

  <section id="view-live" class="view">
    <h2>Where OUR content sits on the genre curve</h2>
    <p class="mut">dps-proxy of each live item / skill (faithful port of tools/check_stat_bands.cjs). Items compare against their rarity's ITEM-scope corpus warn_hi band (content/corpus_stats.json, bands_scope=item); skills compare against the pooled live_self skill-dps band (content/enemy_bands.json) &mdash; the scope/basis is tagged in each row. White marker = warn_hi; red = over band; dark red = beyond the flag bound.</p>
    <div class="summary" id="l-summary"></div>
    <div id="l-body"></div>
  </section>
</main>
<footer>
  <div><b>Attribution</b> &mdash; corpus text is CC-BY-SA third-party reference data (never shipped, never copied verbatim into live content):</div>
  <div id="foot-attrib"></div>
  <div style="margin-top:6px">Generated by tools/build_corpus_browser.py (REQ-0270). Dev-only preview, untracked (web/preview/corpus/). No network at view time.</div>
</footer>
"""
    body = body.replace("__TOTAL__", str(total)).replace("__SRCS__", _esc(srcs))
    parts = [
        "<!DOCTYPE html>",
        '<html lang="en"><head><meta charset="utf-8"/>',
        '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
        "<title>Corpus Browser &middot; REQ-0270</title>",
        "<style>", CSS, "</style></head><body>",
        body,
        '<script id="corpus-data" type="application/json">', data_json,
        "</script>",
        "<script>", JS, "</script>",
        "</body></html>", "",
    ]
    return "\n".join(parts)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def run(data_dir, out_dir, stats_path, items_path=None, skills_path=None,
        enemy_bands_path=None):
    if items_path is None:
        items_path = os.path.join(REPO, "content", "live", "live_items.json")
    if skills_path is None:
        skills_path = os.path.join(REPO, "content", "live", "dungeon",
                                   "skills.json")
    if enemy_bands_path is None:
        enemy_bands_path = os.path.join(REPO, "content", "enemy_bands.json")
    live_specs = [("item", items_path), ("skill", skills_path)]
    dataset = build_dataset(data_dir, stats_path, live_specs, enemy_bands_path)
    html = build_html(dataset)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "index.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    return out_path


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build the dev-only static HTML "
                                 "corpus browser (REQ-0270).")
    ap.add_argument("--data-dir", default="data/corpus",
                    help="normalized corpus dir (contains normalized/*.json)")
    ap.add_argument("--out", default="web/preview/corpus",
                    help="output dir for index.html")
    ap.add_argument("--stats", default="content/corpus_stats.json",
                    help="corpus_stats.json path")
    ap.add_argument("--items", default=None,
                    help="live po/2 items file (default content/live/live_items.json)")
    ap.add_argument("--skills", default=None,
                    help="live skill/1 file (default content/live/dungeon/skills.json)")
    ap.add_argument("--enemy-bands", default=None,
                    help="enemy_bands.json (default content/enemy_bands.json)")
    args = ap.parse_args(argv)
    out_path = run(args.data_dir, args.out, args.stats, args.items,
                   args.skills, args.enemy_bands)
    print("wrote " + out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
