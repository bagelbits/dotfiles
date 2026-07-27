#!/usr/bin/env node
/**
 * Shared comment analyzer for the global CLAUDE.md comment rule: comment the
 * non-obvious *why*, never the *what*; use block style for multiline.
 *
 * Consumed by comment-filter.mjs (PreToolUse on Write/Edit) and
 * pre-pr-comment-check.mjs (PreToolUse on commit/PR). Conservative by design —
 * flags only near-certain junk so it can safely block a write.
 *
 * Run `node comment-rules.mjs --selftest` to exercise the analyzer.
 */

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** Comment body looks like commented-out code. */
const COMMENTED_CODE =
  /^(const |let |var |return\b|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|function\b|class\b|import\b|export\b|await\b|async\b|console\.|\w+\s*\([^)]*\)\s*[;{]?\s*$|.*[;{]\s*$)/;

/** Narration verbs that almost always introduce a "what" comment. */
const WHAT_VERB =
  /^(set|sets|setting|get|gets|getting|return|returns|returning|increment|decrement|loop|loops|iterate|iterates|create|creates|creating|initialize|initializes|declare|declares|assign|assigns|call|calls|calling|define|defines|store|stores|instantiate|instantiates)\b/i;

/** Directives, tags, and deliberate markers that are never redundant. */
const EXEMPT = /^(ponytail:|eslint|@ts-|prettier|biome-|c8 |istanbul |v8 |TODO|FIXME|NOTE|HACK|XXX|https?:)/i;

/**
 * Consecutive `//` lines at or above this count should be a `/** *\/` block —
 * but only when they read as one wrapped sentence. Stacked independent
 * one-liners are fine, so a run only continues on a lowercase-initial line.
 */
const MULTILINE_RUN = 3;
const CONTINUATION = /^[a-z]/;

export function isCodeFile(file) {
  return CODE_EXT.test(file ?? "");
}

/** Extract the body of a single-line `//` comment, or null. */
function commentBody(line) {
  const m = line.match(/^\s*\/\/\s?(.*)$/);
  if (!m) return null;
  const body = m[1].trim();
  if (!body || EXEMPT.test(body)) return null;
  return body;
}

/**
 * Flag redundant comments in a set of added/authored lines.
 *
 * `lines` must be contiguous source lines for run detection to be meaningful;
 * diff callers pass only added lines, so a run there means added-adjacent.
 *
 * @param {string} file path used for the code-file check and messages
 * @param {string[]} lines contiguous source lines
 * @returns {{file:string,text:string,reason:string}[]}
 */
export function analyzeLines(file, lines) {
  if (!isCodeFile(file)) return [];

  const findings = [];
  let run = [];

  const flushRun = () => {
    if (run.length >= MULTILINE_RUN) {
      findings.push({
        file,
        text: run[0],
        reason: `${run.length} consecutive // lines — use /** ... */ block style`,
      });
    }
    run = [];
  };

  for (const raw of lines) {
    const body = commentBody(raw);
    if (body === null) {
      flushRun();
      continue;
    }
    if (run.length && !CONTINUATION.test(body)) flushRun();
    run.push(body);

    if (COMMENTED_CODE.test(body)) {
      findings.push({ file, text: body, reason: "commented-out code" });
    } else if (WHAT_VERB.test(body) && body.split(/\s+/).length <= 8) {
      findings.push({ file, text: body, reason: 'reads as "what", not "why"' });
    }
  }
  flushRun();

  return findings;
}

/**
 * Parse a unified `git diff` and flag added comment lines.
 * @param {string} diff unified diff text
 * @returns {{file:string,text:string,reason:string}[]}
 */
export function analyzeDiff(diff) {
  const findings = [];
  let file = null;
  let batch = [];

  const flush = () => {
    if (file && batch.length) findings.push(...analyzeLines(file, batch));
    batch = [];
  };

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ b/")) {
      flush();
      file = raw.slice(6);
      continue;
    }
    /** A non-added line breaks contiguity, so the run detector must see the gap. */
    if (!raw.startsWith("+") || raw.startsWith("+++")) {
      batch.push("");
      continue;
    }
    batch.push(raw.slice(1));
  }
  flush();

  return findings;
}

/** Render findings as the deny reason handed back to the model. */
export function denyReason(findings, subject) {
  const lines = findings.map((f) => `  • ${f.file}: "${f.text}" — ${f.reason}`).join("\n");
  return (
    `Blocked: ${subject} adds ${findings.length} redundant comment(s). ` +
    `Global CLAUDE.md: comment the non-obvious *why*, never the *what*; ` +
    `use /** ... */ for multiline. Remove or rewrite these, then retry:\n${lines}`
  );
}

/** Emit a PreToolUse deny decision and exit. */
export function deny(reason) {
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

  const kept = [
    "// why: retry guards against a flaky upstream 500",
    "// TODO: revisit after ENT-123",
    "// ponytail: global lock, per-account locks if throughput matters",
    "// eslint-disable-next-line no-console",
    "const counter = 0;",
  ];
  assert(analyzeLines("x.ts", kept).length === 0, `false positives: ${JSON.stringify(analyzeLines("x.ts", kept))}`);

  assert(analyzeLines("x.ts", ["// const old = doThing();"])[0].reason === "commented-out code", "commented-out code");
  assert(analyzeLines("x.ts", ["// Increment the counter"])[0].reason.includes("what"), "what-comment");
  assert(analyzeLines("y.md", ["// Increment the counter"]).length === 0, "non-code file ignored");

  const run = analyzeLines("x.ts", ["// first clause of a long", "// explanation spanning lines", "// and a third line"]);
  assert(
    run.some((f) => f.reason.includes("block style")),
    "3-line wrapped sentence should want block style",
  );
  assert(
    analyzeLines("x.ts", ["// two line run is", "// still acceptable"]).length === 0,
    "2-line run should be allowed",
  );
  assert(
    analyzeLines("x.ts", ["// Guards ENT-4029", "// Mirrors the upstream shape", "// Legacy callers only"]).length === 0,
    "stacked independent one-liners are not a wrapped sentence",
  );

  const diff = [
    "diff --git a/x.ts b/x.ts",
    "+++ b/x.ts",
    "+// const old = doThing();",
    "+// Increment the counter",
    "+// why: retry guards against a flaky upstream 500",
    "+const counter = 0;",
    "diff --git a/y.md b/y.md",
    "+++ b/y.md",
    "+// Increment the counter",
  ].join("\n");
  const d = analyzeDiff(diff);
  assert(d.length === 2, `expected 2 diff findings, got ${d.length}: ${JSON.stringify(d)}`);
  assert(!d.some((x) => x.file.endsWith(".md")), "md file ignored in diff");

  process.stdout.write("comment-rules selftest OK\n");
}

/** Guard on argv[1] so importers running their own selftest don't trigger this one. */
if (process.argv.includes("--selftest") && process.argv[1]?.endsWith("comment-rules.mjs")) selftest();
