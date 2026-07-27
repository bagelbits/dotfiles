#!/usr/bin/env node
/**
 * PreToolUse gate: block commit / PR creation when the branch diff adds
 * redundant comments. Backstop for comment-filter.mjs, which gates each write —
 * this still catches comments authored outside Claude Code.
 *
 * Fails OPEN on any git/tooling error so it never wedges a PR. Analyzer and
 * exemptions live in comment-rules.mjs.
 *
 * Run `node pre-pr-comment-check.mjs --selftest` to exercise the analyzer.
 */

import { execFileSync } from "node:child_process";
import { analyzeDiff, denyReason, deny } from "./comment-rules.mjs";

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

  deny(denyReason(findings, "the branch diff"));
}

function selftest() {
  const assert = (c, m) => {
    if (!c) throw new Error("selftest failed: " + m);
  };
  const diff = [
    "diff --git a/x.ts b/x.ts",
    "+++ b/x.ts",
    "+// const old = doThing();",
    "+// Increment the counter",
    "+// why: retry guards against a flaky upstream 500",
    "+// TODO: revisit after ENT-123",
    "+// ponytail: global lock, fine for now",
    "+const counter = 0;",
    "diff --git a/y.md b/y.md",
    "+++ b/y.md",
    "+// Increment the counter",
  ].join("\n");

  const f = analyzeDiff(diff);
  assert(f.length === 2, `expected 2 findings, got ${f.length}: ${JSON.stringify(f)}`);
  assert(f[0].reason === "commented-out code", "first should be commented-out code");
  assert(f[1].reason.includes("what"), "second should be a what-comment");
  assert(!f.some((x) => x.file.endsWith(".md")), "md file should be ignored");
  process.stdout.write("pre-pr-comment-check selftest OK\n");
}

main();
