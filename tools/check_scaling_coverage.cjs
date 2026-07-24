#!/usr/bin/env node
"use strict";
// tools/check_scaling_coverage.cjs -- REQ-0293. Coverage gate for the enemy
// level-scaling manifest (content/scaling_profile.json). It walks every NUMERIC
// leaf actually present in the live enemy/1 + skill/1 content and FAILS (exit 1)
// if any leaf has no matching rule. Verb leaves resolve by verb.t then _default.
// A profile rule that references a verb or field not present in content is only
// a warning, never a failure -- MISSING coverage is the one hard fail. This makes
// "everything has a scaling" machine-enforced: a new verb or stat without a rule
// turns CI red.
//
// Modes:
//   --gate       walk the live content; exit 1 if any numeric leaf is uncovered
//   --report     same walk, always exit 0 (advisory per-leaf listing)
//   --self-test  inline fixtures: a covered set passes, a new uncovered leaf
//                fails -- exercises the real coverage code path, needs no files
const fs = require("fs");
const path = require("path");
const { loadProfile, resolveVerbRule, isNumericLeaf } = require("../sim/lib/level_scale.cjs");

const ROOT = path.join(__dirname, "..");
const DEFAULT_PROFILE = path.join(ROOT, "content", "scaling_profile.json");
const DEFAULT_ENEMIES = path.join(ROOT, "content", "live", "dungeon", "enemies.json");
const DEFAULT_SKILLS = path.join(ROOT, "content", "live", "dungeon", "skills.json");

// A rule is VALID when it is an object declaring a known kind.
function validRule(rule) {
  return !!rule && typeof rule === "object" && (rule.kind === "geometric" || rule.kind === "flat");
}

// Resolve the rule object that governs one leaf (or undefined).
function ruleForLeaf(profile, leaf) {
  const skill = (profile && profile.skill) || {};
  if (leaf.kind === "enemy") return profile && profile.enemy && profile.enemy[leaf.key];
  if (leaf.kind === "trigger") return skill.trigger && skill.trigger.every_secs && skill.trigger.every_secs.s;
  if (leaf.kind === "verb") return resolveVerbRule(skill, leaf.vt, leaf.key);
  if (leaf.kind === "ap") return skill.attack_profile && skill.attack_profile[leaf.key];
  return undefined;
}

// Enumerate every distinct numeric leaf present in the content, deduplicated by
// path so the report is stable no matter how many entries share a shape.
function collectLeaves(enemyEntries, skillEntries) {
  const byPath = new Map();
  const add = (leaf) => { if (!byPath.has(leaf.path)) byPath.set(leaf.path, leaf); };
  for (const e of enemyEntries || []) {
    for (const k of Object.keys(e)) {
      if (isNumericLeaf(e[k])) add({ kind: "enemy", key: k, path: "enemy." + k });
    }
  }
  for (const s of skillEntries || []) {
    if (s && s.trigger && s.trigger.t === "every_secs" && isNumericLeaf(s.trigger.s)) {
      add({ kind: "trigger", path: "skill.trigger.every_secs.s" });
    }
    if (s && s.verb) {
      const vt = s.verb.t;
      for (const k of Object.keys(s.verb)) {
        if (k !== "t" && isNumericLeaf(s.verb[k])) add({ kind: "verb", vt: vt, key: k, path: "skill.verb." + vt + "." + k });
      }
    }
    if (s && s.attack_profile) {
      for (const k of Object.keys(s.attack_profile)) {
        if (isNumericLeaf(s.attack_profile[k])) add({ kind: "ap", key: k, path: "skill.attack_profile." + k });
      }
    }
  }
  return Array.from(byPath.values());
}

// The real coverage computation. Returns { leaves, covered, missing }.
function computeCoverage(profile, enemyEntries, skillEntries) {
  const leaves = collectLeaves(enemyEntries, skillEntries);
  const covered = [];
  const missing = [];
  for (const leaf of leaves) {
    if (validRule(ruleForLeaf(profile, leaf))) covered.push(leaf); else missing.push(leaf);
  }
  return { leaves: leaves, covered: covered, missing: missing };
}

function loadEntries(p) {
  const doc = JSON.parse(fs.readFileSync(p, "utf8"));
  return doc.entries || doc.skills || [];
}

function runGate(profilePath, enemiesPath, skillsPath, report) {
  const profile = loadProfile(JSON.parse(fs.readFileSync(profilePath, "utf8")));
  if (!profile) {
    console.error("check_scaling_coverage: could not load a scaling/1 profile from " + profilePath);
    return 1;
  }
  const enemyEntries = loadEntries(enemiesPath);
  const skillEntries = loadEntries(skillsPath);
  const res = computeCoverage(profile, enemyEntries, skillEntries);
  console.log("profile: " + profilePath);
  console.log("content: " + enemiesPath + " (" + enemyEntries.length + " enemies), " + skillsPath + " (" + skillEntries.length + " skills)");
  console.log("numeric leaves: " + res.leaves.length + " distinct, " + res.covered.length + " covered, " + res.missing.length + " missing");
  if (report) {
    const sorted = res.leaves.slice().sort((a, b) => (a.path < b.path ? -1 : 1));
    for (const leaf of sorted) {
      const ok = validRule(ruleForLeaf(profile, leaf));
      console.log("  " + (ok ? "OK  " : "MISS") + " " + leaf.path);
    }
  }
  if (res.missing.length) {
    console.error("UNCOVERED numeric leaves (no matching rule -- add one to scaling_profile.json):");
    for (const leaf of res.missing) console.error("  " + leaf.path);
    return 1;
  }
  console.log("check_scaling_coverage: OK (total coverage of live numeric leaves)");
  return 0;
}

function selfTest() {
  const profile = loadProfile({
    schema: "scaling/1",
    enemy: { hp: { kind: "geometric", g: 1.0 }, footprint: { kind: "flat" } },
    skill: {
      trigger: { every_secs: { s: { kind: "flat" } } },
      verb: {
        _default: { n: { kind: "flat" }, hits: { kind: "flat" }, mult: { kind: "flat" }, frac: { kind: "flat" } },
        strike: { n: { kind: "geometric", g: 1.0 } },
      },
      attack_profile: { penetration: { kind: "flat" }, aoe: { kind: "flat" } },
    },
  });
  const enemies = [{ id: "e", hp: [10, 20], footprint: [1, 1], skills: ["k"] }];
  const skillsCovered = [{
    id: "k", trigger: { t: "every_secs", s: [2, 2] },
    verb: { t: "strike", n: [5, 7] }, attack_profile: { penetration: 0, aoe: 0 },
  }];
  // A brand-new numeric leaf the profile declares no rule for (verb "nova" is not
  // in the profile, and "radius" is not a _default key) -- must be flagged.
  const skillsUncovered = skillsCovered.concat([{
    id: "novel", trigger: { t: "every_secs", s: [1, 1] },
    verb: { t: "nova", radius: [3, 3] },
  }]);

  const a = computeCoverage(profile, enemies, skillsCovered);
  const b = computeCoverage(profile, enemies, skillsUncovered);

  const checks = [
    ["covered content has zero missing leaves", a.missing.length === 0, a.missing.map((l) => l.path)],
    ["covered content enumerated the real leaves", a.leaves.length >= 5, a.leaves.length],
    ["a new uncovered numeric leaf is detected", b.missing.length === 1 && b.missing[0].path === "skill.verb.nova.radius", b.missing.map((l) => l.path)],
  ];
  let failed = 0;
  for (const item of checks) {
    const name = item[0], ok = item[1], detail = item[2];
    if (ok) { console.log("PASS  " + name); }
    else { failed++; console.log("FAIL  " + name + " -- " + JSON.stringify(detail)); }
  }
  if (failed) { console.error("check_scaling_coverage self-test: " + failed + " failure(s)"); process.exit(1); }
  console.log("check_scaling_coverage self-test: OK");
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def; };
  const profilePath = opt("--profile", DEFAULT_PROFILE);
  const enemiesPath = opt("--enemies", DEFAULT_ENEMIES);
  const skillsPath = opt("--skills", DEFAULT_SKILLS);
  if (argv.includes("--self-test")) { selfTest(); return; }
  const gate = argv.includes("--gate");
  const report = argv.includes("--report") || !gate;
  const code = runGate(profilePath, enemiesPath, skillsPath, report);
  process.exit(gate ? code : 0);
}

if (require.main === module) main();

module.exports = { computeCoverage: computeCoverage, collectLeaves: collectLeaves, ruleForLeaf: ruleForLeaf, validRule: validRule };
