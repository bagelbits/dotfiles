#!/usr/bin/env node
/**
 * PreToolUse gate on Write/Edit/MultiEdit/NotebookEdit: block a write that
 * introduces redundant comments, handing the reason back to the model so it
 * rewrites before the file lands. Analyzer lives in comment-rules.mjs.
 *
 * Fails OPEN on any parse/IO error — a broken hook must never wedge editing.
 *
 * Run `node comment-filter.mjs --selftest` to exercise the payload extraction.
 */

import { analyzeLines, denyReason, deny } from "./comment-rules.mjs";

/** Lines present in the replaced text are pre-existing, not newly authored. */
function addedLines(newText, oldText) {
  const before = new Set((oldText ?? "").split("\n").map((l) => l.trim()));
  return newText.split("\n").map((l) => (before.has(l.trim()) ? "" : l));
}

/**
 * Reduce a tool payload to the lines this write newly authors.
 * @returns {{file:string,lines:string[]}|null}
 */
export function extract(payload) {
  const name = payload?.tool_name;
  const input = payload?.tool_input ?? {};
  const file = input.file_path ?? input.notebook_path ?? "";

  switch (name) {
    case "Write":
      return { file, lines: (input.content ?? "").split("\n") };
    case "Edit":
      return { file, lines: addedLines(input.new_string ?? "", input.old_string) };
    case "MultiEdit":
      return {
        file,
        lines: (input.edits ?? []).flatMap((e) => addedLines(e.new_string ?? "", e.old_string)),
      };
    case "NotebookEdit":
      /** Notebook cells are python/markdown; the analyzer's ext check drops them anyway. */
      return { file, lines: (input.new_source ?? "").split("\n") };
    default:
      return null;
  }
}

async function main() {
  if (process.argv.includes("--selftest")) return selftest();

  const { readFileSync } = await import("node:fs");
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }

  const target = extract(payload);
  if (!target?.file) process.exit(0);

  const findings = analyzeLines(target.file, target.lines);
  if (findings.length === 0) process.exit(0);

  deny(denyReason(findings, "this write"));
}

function selftest() {
  const assert = (c, m) => {
    if (!c) throw new Error("selftest failed: " + m);
  };

  const write = extract({
    tool_name: "Write",
    tool_input: { file_path: "a.ts", content: "// Increment the counter\ncount++;" },
  });
  assert(analyzeLines(write.file, write.lines).length === 1, "Write content analyzed");

  const edit = extract({
    tool_name: "Edit",
    tool_input: {
      file_path: "a.ts",
      old_string: "// Increment the counter\ncount++;",
      new_string: "// Increment the counter\ncount += 2;",
    },
  });
  assert(analyzeLines(edit.file, edit.lines).length === 0, "pre-existing comment in old_string not re-flagged");

  const added = extract({
    tool_name: "Edit",
    tool_input: { file_path: "a.ts", old_string: "count++;", new_string: "// Increment the counter\ncount++;" },
  });
  assert(analyzeLines(added.file, added.lines).length === 1, "newly added comment flagged");

  const multi = extract({
    tool_name: "MultiEdit",
    tool_input: {
      file_path: "a.ts",
      edits: [
        { old_string: "a", new_string: "// const dead = 1;" },
        { old_string: "b", new_string: "// why: upstream is flaky" },
      ],
    },
  });
  assert(analyzeLines(multi.file, multi.lines).length === 1, "MultiEdit flags only the junk edit");

  assert(extract({ tool_name: "Bash", tool_input: { command: "ls" } }) === null, "non-write tool ignored");

  const nonCode = extract({
    tool_name: "Write",
    tool_input: { file_path: "notes.md", content: "// Increment the counter" },
  });
  assert(analyzeLines(nonCode.file, nonCode.lines).length === 0, "non-code file ignored");

  process.stdout.write("comment-filter selftest OK\n");
}

/** Guard on argv[1] so importing this module (tests, tooling) doesn't consume stdin. */
if (process.argv[1]?.endsWith("comment-filter.mjs")) main();
