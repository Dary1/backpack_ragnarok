# -*- coding: utf-8 -*-
"""
REQ-0029 follow-up: transpose shape/ports for the 6 escalated batch-001-niflheim
draft.json entries. The draft.json shape tuples were authored under the OLD
(wrong) [col,row] tool convention; the engine (and now the fit tools, since
REQ-0029a) read shape as [row,col]. Art is authoritative (art_golden v3.3);
the fix is transposing the DATA, not the art.

For each of the 6 entries: swap every [a,b] -> [b,a] in "shape" and in every
port's "tiles" list (same [row,col] coordinate space, external neighbor cells
-- transposing them the same way keeps each port's position RELATIVE to the
shape unchanged, e.g. hoarfrost_creep's Flame-port stays tucked into the L's
concave notch).
"""
import json

PATH = "content/batches/batch-001-niflheim/draft.json"
TARGET_IDS = {
    "rime_shard", "frost_nail", "hoarfrost_creep",
    "glacier_cleaver", "permafrost_ward", "niflheim_crown",
}

def transpose_pairs(pairs):
    return [[b, a] for a, b in pairs]

with open(PATH, encoding="utf-8") as f:
    data = json.load(f)

changed = []
for e in data["entries"]:
    if e["id"] not in TARGET_IDS:
        continue
    old_shape = e["shape"]
    e["shape"] = transpose_pairs(old_shape)
    old_ports = None
    new_ports = None
    if "ports" in e:
        old_ports = [list(p["tiles"]) for p in e["ports"]]
        for p in e["ports"]:
            p["tiles"] = transpose_pairs(p["tiles"])
        new_ports = [p["tiles"] for p in e["ports"]]
    changed.append((e["id"], old_shape, e["shape"], old_ports, new_ports))

with open(PATH, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
    f.write("\n")

for cid, old_s, new_s, old_p, new_p in changed:
    print(f"{cid}: shape {old_s} -> {new_s}")
    if old_p is not None:
        print(f"  ports {old_p} -> {new_p}")
print(f"\n{len(changed)} entries transposed in {PATH}")
