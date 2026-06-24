---
name: multi-agent-pr-review
description: >-
  Use when the user asks for a multi-agent, multi-perspective, or "agentic team"
  review of a GitHub pull request. Triggers on phrases like "review this as a
  team", "agentic review", "architect / staff engineer / devil's advocate /
  security auditor review", "high-level review", "big-picture review",
  "security perspective on this PR", "give me different
  perspectives on this PR", or any time the user explicitly asks for non-nitpick
  PR feedback. Also triggers when the user pastes a GitHub PR URL alongside a
  request for review and wants more than one viewpoint. Skip for line-by-line
  code review (use ordinary review instead) or when the user wants only a single
  reviewer.
allowed-tools: Bash, Read, Write, Edit, Agent, Grep
---

# Multi-Agent PR Review

A two-phase skill: dispatch four independent reviewers (architect, staff
engineer, devil's advocate, security auditor) on a GitHub PR for big-picture
findings, then support drill-down questions ("where can we do that?") with
concrete file/line locations and proposed fixes.

## When to Use

- User asks for a "team review", "agentic review", or names any of the roles.
- User wants different perspectives on architecture, risk, and premise.
- User explicitly says "no nits" / "big picture" / "high level".
- User pastes a PR URL and wants more than a single-reviewer pass.

## When NOT to Use

- Line-by-line code review (one reviewer is enough — use the platform's review
  flow).
- Style/formatting review (the linter is the right tool).
- The user wants a single perspective, not a multi-reviewer panel.
- There's no PR URL and no diff to review.

## Phase 1 — Run the review

### Step 1. Fetch the PR once, save to disk

Four subagents will read the diff independently. Fetching it once and writing
to a known path avoids each subagent re-fetching (slow) and keeps token use
predictable. Use `/tmp/pr-<NUMBER>/` as a working directory.

```bash
mkdir -p /tmp/pr-<NUMBER>
gh pr view <NUMBER> --repo <OWNER/REPO> --json \
  title,body,author,state,additions,deletions,changedFiles,baseRefName,headRefName,commits,files \
  > /tmp/pr-<NUMBER>/meta.json
gh pr diff <NUMBER> --repo <OWNER/REPO> > /tmp/pr-<NUMBER>/diff.patch
```

Read `meta.json` yourself to extract:

- PR title and body (the "why")
- File list with line counts (so each persona knows where to focus)
- Linked tickets / tech proposals mentioned in the description

You'll feed those into each persona's prompt as **Context**. Don't make the
subagents re-derive context from raw JSON; that wastes tokens and produces
inconsistent framing across the reports.

### Step 2. Dispatch the four reviewers in a single message

All four agents are independent — send them in **one** assistant message
containing four `Agent` tool calls, so they run in parallel. Sequential
dispatch wastes wall-clock time and is the single most common mistake in this
skill.

Use `subagent_type: "general-purpose"` for each. Each prompt must:

1. Name the persona and the angle.
2. Include **Context** (PR purpose, key files with line counts, linked
   proposal/ticket if any).
3. Point at `/tmp/pr-<NUMBER>/diff.patch` as the diff source.
4. Spell out the angle as numbered prompt questions (3-5 of them).
5. Cap output at ~450-500 words (a little more than a pure-findings review
   because each finding must carry a fix).
6. Demand: numbered findings, each with **claim · why-it-matters · file/line
   · recommended fix**. Every finding ships with a concrete solution — not
   just a diagnosis. A finding without a proposed fix is incomplete; the
   reviewer should say "no fix obvious, needs discussion" rather than omit
   the field.
7. Forbid nitpicks (style, naming, formatting, micro-refactors).

Why solutions are required: a flagged risk without a proposed direction
pushes synthesis work onto the user. The personas are senior enough to
recommend a fix or explicitly say "needs design discussion" when they can't.
"Consider improving X" is not a fix — it's a restatement of the problem.

Persona prompt scaffolds follow. Adjust **Context** and file list per PR; keep
the structural directives (output format, word budget, no-nits rule) intact.

#### Architect prompt

```
You are a Principal Architect reviewing PR #<N> on <OWNER/REPO>. The user
explicitly asked for BIG-PICTURE findings — do NOT nitpick style, naming, or
small refactors. Think architecture, boundaries, long-term consequences.

## Context
<2-4 sentence summary of what the PR does and why; quote the PR description's
"why" verbatim if useful>

## Key files (in /tmp/pr-<N>/diff.patch)
<bulleted list with paths and line counts from meta.json>

## Your job
Read /tmp/pr-<N>/diff.patch. Form a view on:
1. Architectural soundness — is this the right shape, or does it paint the team
   into a corner? 12-month trajectory.
2. Boundary placement — does this live in the right app/package? What
   abstraction should exist now but doesn't?
3. Contract / protocol design — schemas, versioning, evolvability.
4. Shared-component bleed — does host-specific behavior leak into shared code?
5. Auth / security model coherence (if applicable).
6. Release coupling — independent ship cadences, broken contracts.

Respond in under ~500 words. Lead with the 3-5 most consequential findings
ranked. Each finding is **claim · why-it-matters · file/line · recommended
fix** — the fix is a concrete direction (new shape, replaced mechanism,
specific refactor), not "consider improving X." If no fix is obvious, say
"needs design discussion" and name what's unclear. Then one paragraph: "what
I'd do differently if starting over." No markdown headers per finding — just
a numbered list.
```

#### Staff engineer prompt

```
You are a Staff Engineer reviewing PR #<N> on <OWNER/REPO>. The user explicitly
asked for BIG-PICTURE findings — do NOT nitpick. Focus on correctness, failure
modes, operational risk, and testability.

## Context
<same 2-4 sentence summary>

## Key files (in /tmp/pr-<N>/diff.patch)
<same bulleted list>

## Your job
Read /tmp/pr-<N>/diff.patch. Form a view on:
1. Failure modes — what happens on timeout / flake / race / unmount / retry?
   How are these surfaced, logged, retried?
2. Robustness of the critical path — auth, mutations, streams, lifecycle.
3. Race conditions / ordering / idempotency on async boundaries.
4. Observability — is there enough structured signal to debug a cross-boundary
   issue in prod?
5. Test quality — behavior vs implementation; critical paths untested.
6. Bundle / performance cost of the change.

Respond in under ~500 words. Lead with the 3-5 most consequential findings,
ranked by operational risk × likelihood. Each finding is **claim ·
why-it-matters · file/line · recommended fix** — the fix is concrete (the
logger call to swap in, the timeout wrapper to add, the test to write), not
"add more tests" or "consider error handling." If you can't see a fix, say
"needs design discussion" and name what's unclear. Then one paragraph: "if
shipping Monday, must-fix vs. follow-up." No markdown headers per finding —
just a numbered list.
```

#### Devil's advocate prompt

```
You are playing Devil's Advocate on PR #<N> in <OWNER/REPO>. Your ONLY job is
to argue against the current approach — stress-test the premise, not the
details. BIG-PICTURE ONLY. If you can't find substantive objections, say so
explicitly rather than inventing weak ones.

## Context
<same 2-4 sentence summary, plus the PR's stated motivation if any>

## Key files (in /tmp/pr-<N>/diff.patch)
<same bulleted list>

## Your job — argue the contrarian case
Read /tmp/pr-<N>/diff.patch. Lead with:
1. Challenge the premise — is this even the right strategy? What's the failure
   mode no one is discussing?
2. Challenge stated benefits — does the PR already contradict its own pitch?
3. Challenge any new bespoke trust boundary or protocol the team is signing up
   to maintain forever.
4. Challenge the "ship and iterate" posture — what does the security/hardening
   trail say about review #1?
5. Hidden cost ledger — what does ownership look like in 12 months? Who pages?

Respond in under ~450 words. Be sharp, specific, and concede where the approach
is defensible — unconvincing contrarianism is worse than none. Lead with your
single strongest objection, then 2-3 more, then one concession. Each objection
ends with a **recommended alternative**: the cheaper path the team should have
considered (a different strategy, a descope, a sequencing change). "This is
wrong" without "try this instead" is complaint, not review. No markdown
headers — just numbered points.
```

#### Security auditor prompt

```
You are a Security Audit Expert reviewing PR #<N> on <OWNER/REPO>, specializing
in frontend and Backend-for-Frontend (BFF) security. The user asked for
BIG-PICTURE findings — flag real, exploitable risk, not theoretical hardening
or style. If the diff has no material security exposure, say so explicitly
rather than inventing low-value findings.

## Context
<same 2-4 sentence summary>

## Key files (in /tmp/pr-<N>/diff.patch)
<same bulleted list>

## Your job
Read /tmp/pr-<N>/diff.patch. Form a view on (skip the categories the diff
doesn't touch):
1. Injection & untrusted input — XSS (`dangerouslySetInnerHTML`, `eval`,
   unsanitized render), SQL/NoSQL/command injection, path traversal, SSRF.
   Is input validated/sanitized at the boundary (zod or equivalent)?
2. AuthN/AuthZ — broken access control, missing checks on API routes /
   `getServerSideProps`, client-only auth, weak JWT/session handling, RBAC gaps.
3. Secrets & config — exposed keys, `NEXT_PUBLIC_*` leaking sensitive data,
   `.env`/`next.config.js` misconfig, overly permissive CORS.
4. Data exposure & error handling — stack traces / DB errors / internal paths
   leaking, PII in logs, missing rate limiting / brute-force protection.
5. Supply chain — new or bumped deps with known CVEs, integrity risks.
Use the OWASP Top 10 (2021) as a lens, not a checklist to pad findings with.

Respond in under ~500 words. Lead with the 3-5 most consequential findings,
ranked by severity × exploitability. Each finding is **severity (Critical/High/
Medium/Low) · claim · impact (what an attacker does) · file/line · recommended
fix** — the fix is concrete (the validation to add, the cookie flags to set,
the check to enforce), not "sanitize inputs" or "improve auth." Cite OWASP/CVE
references where they sharpen the point. If you can't see a fix, say "needs
security design discussion" and name the open question. Then one line: the
single must-fix-before-merge item if one exists. No markdown headers per
finding — just a numbered list.
```

### Step 3. Consolidate into one report

When all four agents return, synthesize — don't just paste the four blocks.
Every finding carries its recommended fix inline; preserve those fixes
verbatim (or refined) rather than stripping them in the consolidation.
Layout:

```
## 🏛️ Architect — strategic shape
<numbered findings, each ending with "**Fix:** ...">

## 🛠️ Staff Engineer — operational risk
<numbered findings, each ending with "**Fix:** ...">

## 😈 Devil's Advocate — challenge the premise
<numbered objections, each ending with "**Alternative:** ...">

## 🔒 Security Auditor — exploitable risk
<numbered findings, each led by severity and ending with "**Fix:** ...">

## 🎯 Cross-cutting consensus
<which findings did 2+ agents converge on? what's the single decision to
force before merging? — name the concrete action, not the abstract concern>

## 📋 Suggestions digest
<flat table of every fix proposed, grouped by reviewer, so the user can
scan/act without re-reading the narrative. Columns: Finding · Recommended
fix. Include must-fix-before-merge and follow-up items separately if the
staff engineer flagged them.>
```

Both the consensus and the digest are the highest-value part of the output:
consensus tells the user what to act on first; the digest is what they paste
into a tracking ticket or review thread. Look for the same concern surfacing
in different language across reports and merge identical fixes.

## Phase 2 — Drill-down on a specific finding

After the report lands, the user often picks one finding and asks "where can
we do that?" or pastes a finding back. Don't re-dispatch agents — answer
yourself from the saved diff:

1. **Locate** — `grep -n "<symbol>" /tmp/pr-<N>/diff.patch` for the function
   names, error strings, or filenames in the finding.
2. **Read context** — `Read /tmp/pr-<N>/diff.patch` with the offset around
   the match (±30 lines) to see the surrounding code.
3. **Cite precisely** — give the user file path + diff-line number ("…in
   `pages/mobile-auth/index.tsx`, diff lines ~420-430") so they can navigate
   the PR directly.
4. **Propose a concrete change** — show the current snippet and a recommended
   replacement. Respect repo conventions (logger, error-handling rules,
   lint config) you find in `CLAUDE.md` or `.claude/rules/`.
5. **Offer follow-up** — at the end, ask whether to draft this as a follow-up
   PR or as inline review comments. Don't open the PR yourself without consent.

## Output Quality

**Bad — diagnosis without direction:**

> "Consider improving error handling and adding more tests."

**Bad — finding present, fix is a restatement:**

> "The listener race will drop messages. **Fix:** handle the race condition."

**Good — claim · why · location · concrete fix:**

> "1. Listener/queue race in `/chat-widget` will silently drop initial
> prompts. Page listener writes to `queuedMessageRef` and Body's
> `useEffect(...,[])` reads `initialMessage` once on mount — anything posted
> before the listener attaches is dropped with no Sentry breadcrumb. The
> marquee feature's window is racy. File: `pages/chat-widget/index.tsx`
> lines 154-163. **Fix:** make the page the single bridge owner — expose
> `sendMessage` on `ChatWidgetMobile` via an `onReady` callback, queue
> messages in the page until `onReady` fires, dedup by a native-provided
> `messageId`. Drop the listener inside `ChatWidgetMobileBody`."

**Bad — four blocks of agent output pasted with no synthesis:**

> [Architect output] [Staff output] [Devil output] [Security output]

**Good — consolidated with consensus section that names the single decision
to force:**

> "Three independent reviewers converged on the bridge protocol lacking a
> single owner / version. If you want one decision to force before merging:
> name an owner for the contract and extract it to a typed package."

## Quality Checklist

Before reporting completion of Phase 1:

- [ ] Diff was fetched once to `/tmp/pr-<N>/diff.patch`, not four times.
- [ ] All four Agent calls were sent in a single message (parallel).
- [ ] Each agent prompt named its persona, included PR Context, pointed at the
      saved diff, required a recommended fix per finding, and capped output at
      the word budget.
- [ ] Every finding in the consolidation ships with a concrete **Fix** /
      **Alternative** — not "consider improving X," not "handle the race." If
      an agent left one naked, add the fix yourself from the diff or mark it
      "needs design discussion" with what's unclear.
- [ ] The consolidated report has all four reviewer sections plus a
      cross-cutting consensus paragraph **and** a Suggestions digest table.
- [ ] The consensus paragraph names a concrete decision to force (e.g. "name
      an owner for the bridge contract and extract it to a typed package"),
      not an abstract concern.
- [ ] Findings cite file paths (and diff-line numbers when claiming a bug).
- [ ] No agent's output is pure style nitpicks — if one drifted, redirect or
      drop it from the consolidation rather than pasting noise.

For Phase 2 drill-downs:

- [ ] You read the saved diff before claiming a location.
- [ ] You cited file path + diff-line range, not just "somewhere in the auth
      flow".
- [ ] Proposed code respects repo conventions (logger usage, error handling
      rules, lint).
- [ ] You offered a concrete next action (follow-up PR / review comments) but
      did not act without consent.

## Common Pitfalls

- **Sequential dispatch.** Four Agent calls in separate assistant messages
  quadruples wall-clock time and breaks parallelism. Always send them in one
  message.
- **Re-fetching the diff in each agent.** Wastes time and can produce drift if
  the PR updates between fetches. Save once, point all four at the same path.
- **Pasting four blocks without synthesis.** The cross-cutting consensus is
  what the user actually buys with this skill.
- **Letting an agent nit.** If an agent comes back with naming/formatting
  notes, mention it briefly or drop it. Don't promote nits to top-level
  findings.
- **Drilling down by re-dispatching.** Phase 2 doesn't need new agents — the
  diff is on disk and you have the finding text.
- **Findings without fixes.** "Consider improving error handling" and "handle
  the race" are not fixes. If an agent returns a bare finding, attach the
  fix yourself from the diff, or mark it "needs design discussion" with the
  specific open question. Don't pass diagnosis-only work back to the user —
  that's what this skill is supposed to prevent.
