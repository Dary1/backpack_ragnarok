#!/usr/bin/env node
// REQ-0288 tripwire: drag ghosts MUST resolve textures through THE shared
// chain (board/itemArt.ts itemTex) -- never a legacy sprite-key lookup, and
// BoardRenderer must never regrow a private copy (that private copy is how
// the ghost path silently drifted when REQ-0133 upgraded the placed path).
import { readFileSync } from 'node:fs';
const ghosts = readFileSync(new URL('../src/board/ghosts.ts', import.meta.url), 'utf8');
const br = readFileSync(new URL('../src/board/BoardRenderer.ts', import.meta.url), 'utf8');
const art = readFileSync(new URL('../src/board/itemArt.ts', import.meta.url), 'utf8');
const drag = readFileSync(new URL('../src/board/drag.ts', import.meta.url), 'utf8');
const fail = (m) => { console.error('check_ghost_chain: FAIL -- ' + m); process.exit(1); };
if (!/import \{ itemTex \} from '\.\/itemArt';/.test(ghosts)) fail("ghosts.ts must import itemTex from './itemArt'");
// CODE-shaped legacy lookups only (a doc comment may cite the old pattern):
if (/=\s*(?:bladeDef|hiltDef)\s*&&\s*textures\.get\(/.test(ghosts)) fail('ghosts.ts: assembly ghost still uses a legacy sprite-key lookup');
if (/const texture = textures\.get\(def\.icon\);/.test(ghosts)) fail('ghosts.ts: PO ghost still uses a legacy sprite-key lookup');
if (/^function itemTex\(/m.test(br)) fail('BoardRenderer.ts regrew a local itemTex');
if (!/export function itemTex\(/m.test(art)) fail('itemArt.ts must export itemTex');
if (!/revertFeedback/.test(drag)) fail('drag.ts lost the revertFeedback seam');
console.log('check_ghost_chain: OK');
