// Tag-ancestry helper — REQ-0035. Walks vocab.json's po_tags tree (a flat
// map of tag -> parent tag, or null for a root) from a leaf tag up to its
// root, for the Dex's "tags with full hierarchy path" display. Pure
// function, no I/O -- the tree itself comes from ApiTrees.po (already
// fetched as part of /api/content, see api.ts's ApiTrees type).
export type TagTree = Record<string, string | null>;

/** Returns [root, ..., parent, tag] for `tag` (tag itself last), walking
 * `tree` upward via each key's parent value until a null-parented root is
 * reached. Returns [tag] unchanged if `tag` is not a key in `tree` (an
 * unknown tag some legacy content might carry) or if a cycle is detected
 * (defensive -- vocab.json is hand-authored and should never cycle, but a
 * malformed edit must not hang the UI). */
export function ancestryPath(tree: TagTree, tag: string): string[] {
  const path: string[] = [];
  let cur: string | null = tag;
  const seen = new Set<string>();
  while (cur !== null && cur !== undefined) {
    if (seen.has(cur)) break; // cycle guard
    seen.add(cur);
    path.unshift(cur);
    if (!(cur in tree)) break; // unknown tag -- stop, keep what we have
    cur = tree[cur];
  }
  return path;
}
