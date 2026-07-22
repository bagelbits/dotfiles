#!/usr/bin/env node
/**
 * PreToolUse gate: block PR creation when the branch diff adds obviously
 * redundant comments (commented-out code, or "what"-narration comments that
 * restate the next line). Conservative by design — it only flags near-certain
 * junk, and fails OPEN on any git/tooling error so it never wedges a PR.
 *
 * Enforces the global CLAUDE.md comment rule: comment the non-obvious *why*,
 * never the *what*. Subtle why-vs-what calls are left to human review.
 *
 * Run `node pre-pr-comment-check.mjs --selftest` to exercise the analyzer.
 */

import { execFileSync } from "node:child_process";

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** Comment body looks like commented-out code. */
const COMMENTED_CODE =
  /^(const |let |var |return\b|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|function\b|class\b|import\b|export\b|await\b|async\b|console\.|\w+\s*\([^)]*\)\s*[;{]?\s*$|.*[;{]\s*$)/;

/** Narration verbs that almost always introduce a "what" comment. */
const WHAT_VERB =
  /^(set|sets|setting|get|gets|getting|return|returns|returning|increment|decrement|loop|loops|iterate|iterates|create|creates|creating|initialize|initializes|declare|declares|assign|assigns|call|calls|calling|define|defines|store|stores|instantiate|instantiates)\b/i;

/**
 * Parse a `git diff` and return flagged added comment lines.
 * @param {string} diff unified diff text
 * @returns {{file:string,text:string,reason:string}[]}
 */
export function analyzeDiff(diff) {
  const findings = [];
  let file = null;
  let inCode = false;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ b/")) {
      file = raw.slice(6);
      inCode = CODE_EXT.test(file);
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("diff ") || raw.startsWith("@@")) continue;
    if (!inCode || !raw.startsWith("+") || raw.startsWith("+++")) continue;

    const added = raw.slice(1);
    const m = added.match(/^\s*\/\/\s?(.*)$/); // single-line // comment only
    if (!m) continue;
    const body = m[1].trim();
    if (!body || /^ponytail:/i.test(body) || /^(eslint|@ts-|prettier|TODO|FIXME|NOTE|HACK|XXX|https?:)/i.test(body)) {
      continue;
    }

    if (COMMENTED_CODE.test(body)) {
      findings.push({ file, text: body, reason: "commented-out code" });
    } else if (WHAT_VERB.test(body) && body.split(/\s+/).length <= 8) {
      findings.push({ file, text: body, reason: 'reads as "what", not "why"' });
    }
  }
  return findings;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function branchDiff() {
  for (const base of ["origin/main", "main", "origin/master", "master"]) {
    try {
      git(["rev-parse", "--verify", base]);
      return git(["diff", "--merge-base", base]);
    } catch {
      /* try next base */
    }
  }
  return null; // no base found → fail open
}

function main() {
  if (process.argv.includes("--selftest")) return selftest();

  let diff;
  try {
    diff = branchDiff();
  } catch {
    process.exit(0); // not a git repo / git error → allow
  }
  if (!diff) process.exit(0);

  const findings = analyzeDiff(diff);
  if (findings.length === 0) process.exit(0);

  const lines = findings.map((f) => `  • ${f.file}: "${f.text}" — ${f.reason}`).join("\n");
  const reason =
    `Blocked: the branch diff adds ${findings.length} redundant comment(s). ` +
    `Global CLAUDE.md: comment the non-obvious *why*, never the *what*. ` +
    `Remove or rewrite these, then retry:\n${lines}`;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function selftest() {
  const assert = (c, m) => {
    if (!c) throw new Error("selftest failed: " + m);
  };
  const diff = [
    "diff --git a/x.ts b/x.ts",
    "+++ b/x.ts",
    "+// const old = doThing();", // commented-out code
    "+// Increment the counter", // what-comment
    "+// why: retry guards against a flaky upstream 500", // why → keep
    "+// TODO: revisit after ENT-123", // tag → keep
    "+// ponytail: global lock, fine for now", // ponytail → keep
    "+const counter = 0;", // real code, not a comment
    "diff --git a/y.md b/y.md",
    "+++ b/y.md",
    "+// Increment the counter", // non-code file → ignored
  ].join("\n");

  const f = analyzeDiff(diff);
  assert(f.length === 2, `expected 2 findings, got ${f.length}: ${JSON.stringify(f)}`);
  assert(f[0].reason === "commented-out code", "first should be commented-out code");
  assert(f[1].reason.includes("what"), "second should be a what-comment");
  assert(!f.some((x) => x.file.endsWith(".md")), "md file should be ignored");
  process.stdout.write("selftest OK\n");
}

main();
