#!/usr/bin/env python3
"""REQ-0268 -- corpus_fetch: download genre wiki data via MediaWiki api.php.

Stdlib only (urllib, json, time). Fetches the ratified sources -- Backpack Hero
and Backpack Battles (Fandom wikis, content CC-BY-SA) -- and caches the raw page
JSON under data/corpus/raw/<source>/pages/<pageid>.json, plus a per-source
manifest.json.

This is a REFERENCE corpus (REQ-0268): the data is internal tooling grounding
only -- never training data, never copied verbatim into live content.

Politeness: descriptive User-Agent, >=1s between requests, idempotent caching
(cached pages are skipped unless --refresh).

Usage:
  python3 tools/corpus_fetch.py [--source NAME|all] [--limit N] [--refresh]
                                [--out DIR] [--delay SECS]
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

TOOL_VERSION = "1"
USER_AGENT = ("backpack_ragnarok corpus tool; internal research; "
             "contact ahyaqtie@gmail.com")
LICENSE = "CC-BY-SA"

# Ratified sources. Endpoints discovered via the MediaWiki siteinfo API
# (both resolve on Fandom under hyphenated hosts).
SOURCES = {
    "backpack-hero": {
        "endpoint": "https://backpack-hero.fandom.com/api.php",
        "wiki_title": "Backpack Hero Wiki",
    },
    "backpack-battles": {
        "endpoint": "https://backpack-battles.fandom.com/api.php",
        "wiki_title": "Backpack Battles Wiki",
    },
}

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
DEFAULT_OUT = os.path.join(REPO, "data", "corpus", "raw")


def _get(endpoint, params, retries=3, timeout=30):
    params = dict(params)
    params["format"] = "json"
    url = endpoint + "?" + urllib.parse.urlencode(params)
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError,
                TimeoutError, ValueError, OSError) as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("request failed after %d tries: %s (%s)" %
                       (retries, url, last))


def enumerate_pages(endpoint, delay):
    """List all real (non-redirect) content pages in the main namespace."""
    pages = []
    cont = {}
    while True:
        params = {"action": "query", "list": "allpages", "apnamespace": "0",
                  "aplimit": "500", "apfilterredir": "nonredirects"}
        params.update(cont)
        j = _get(endpoint, params)
        for p in j.get("query", {}).get("allpages", []):
            pages.append({"pageid": p["pageid"], "title": p["title"]})
        cont = j.get("continue")
        if not cont:
            break
        time.sleep(delay)
    pages.sort(key=lambda p: p["pageid"])
    return pages


def fetch_page(endpoint, pageid, delay):
    params = {"action": "query", "prop": "revisions|categories",
              "pageids": str(pageid), "rvprop": "content", "rvslots": "main",
              "cllimit": "max"}
    j = _get(endpoint, params)
    pages = j.get("query", {}).get("pages", {})
    p = list(pages.values())[0] if pages else {}
    wikitext = ""
    revs = p.get("revisions")
    if revs:
        wikitext = revs[0].get("slots", {}).get("main", {}).get("*", "")
    cats = [c["title"] for c in p.get("categories", [])]
    time.sleep(delay)
    return {"title": p.get("title", ""), "wikitext": wikitext, "categories": cats}


def fetch_source(name, out_root, limit, refresh, delay, fetched):
    cfg = SOURCES[name]
    endpoint = cfg["endpoint"]
    src_dir = os.path.join(out_root, name)
    pages_dir = os.path.join(src_dir, "pages")
    os.makedirs(pages_dir, exist_ok=True)
    print("[%s] enumerating pages ..." % name)
    listing = enumerate_pages(endpoint, delay)
    if limit:
        listing = listing[:limit]
    print("[%s] %d pages to consider" % (name, len(listing)))
    fetched_n = skipped_n = failed_n = 0
    failures = []
    for i, item in enumerate(listing):
        pid = item["pageid"]
        path = os.path.join(pages_dir, "%d.json" % pid)
        if os.path.exists(path) and not refresh:
            skipped_n += 1
            continue
        try:
            data = fetch_page(endpoint, pid, delay)
        except Exception as e:  # noqa: BLE001 -- one bad page must not kill the run
            failed_n += 1
            failures.append({"pageid": pid, "title": item["title"],
                             "error": str(e)[:200]})
            print("  ! failed pageid=%d %s: %s" % (pid, item["title"], str(e)[:120]))
            continue
        record = {
            "source": name, "endpoint": endpoint, "license": LICENSE,
            "tool_version": TOOL_VERSION, "fetched": fetched,
            "pageid": pid, "title": data["title"],
            "categories": data["categories"], "wikitext": data["wikitext"],
        }
        with open(path, "w", encoding="utf-8") as f:
            json.dump(record, f, ensure_ascii=False, indent=1)
        fetched_n += 1
        if fetched_n % 25 == 0:
            print("  .. fetched %d (%d/%d)" % (fetched_n, i + 1, len(listing)))
    manifest = {
        "source": name, "endpoint": endpoint, "license": LICENSE,
        "wiki_title": cfg["wiki_title"], "fetch_date": fetched,
        "tool_version": TOOL_VERSION, "page_count": len(listing),
        "fetched_this_run": fetched_n, "skipped_cached": skipped_n,
        "failed": failed_n, "failures": failures,
    }
    with open(os.path.join(src_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print("[%s] done: fetched=%d skipped=%d failed=%d page_count=%d" %
          (name, fetched_n, skipped_n, failed_n, len(listing)))
    return manifest


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Fetch genre wiki corpus (MediaWiki api.php).")
    ap.add_argument("--source", default="all",
                    help="source name or 'all' (default all)")
    ap.add_argument("--limit", type=int, default=0,
                    help="cap pages per source (smoke runs)")
    ap.add_argument("--refresh", action="store_true",
                    help="re-fetch cached pages")
    ap.add_argument("--out", default=DEFAULT_OUT, help="raw output root")
    ap.add_argument("--delay", type=float, default=1.0,
                    help="seconds between requests (floored at 1.0)")
    args = ap.parse_args(argv)
    delay = max(1.0, args.delay)
    fetched = time.strftime("%Y-%m-%d")
    if args.source == "all":
        names = list(SOURCES.keys())
    elif args.source in SOURCES:
        names = [args.source]
    else:
        ap.error("unknown source %r; known: %s" %
                 (args.source, ", ".join(sorted(SOURCES))))
    for name in names:
        fetch_source(name, args.out, args.limit, args.refresh, delay, fetched)
    return 0


if __name__ == "__main__":
    sys.exit(main())
