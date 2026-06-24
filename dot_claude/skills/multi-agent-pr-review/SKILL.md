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
  request for review and wants more than one viewpoint, or asks to "verify" /
  "fact-check" a panel's findings. Skip for line-by-line code review (use
  ordinary review instead) or when the user wants only a single reviewer.
allowed-tools: Bash, Read, Write, Edit, Agent, SendMessage, Grep
---

# Multi-Agent PR Review

A skill in three movements: (1) dispatch four independent reviewers (architect,
staff engineer, devil's advocate, security auditor) as a named **team** on a
GitHub PR for big-picture findings; (2) kick off an independent **verifier**
that fact-checks the panel's findings against the diff and challenges weak ones
back to their author; (3) consolidate, then support drill-down questions
("where can we do that?") with concrete file/line locations and proposed fixes.

This skill assumes agent teams are enabled
(`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), so panelists are spawned as
**named, addressable background teammates** and the verifier can message them
mid-flight. If teams are unavailable, see the fallback note in Step 2.

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

## Phase 1 — Run the panel

### Step 1. Fetch the PR once, save to disk

Four subagents will read the diff independently. Fetching it once and writing
to a known path avoids each subagent re-fetching (slow) and keeps token use
predictable. Use `/tmp/pr-<NUMBER>/` as a working directory.

```bash
mkdir -p /tmp/pr-<NUMBER>/panel
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

### Step 2. Dispatch the four reviewers as a named team, in a single message

All four agents are independent — send them in **one** assistant message
containing four `Agent` tool calls, so they run in parallel. Sequential
dispatch wastes wall-clock time and is the single most common mistake in this
skill.

Spawn each as a **named background teammate** so the verifier (Phase 2) can
message it later with its review context intact:

- `subagent_type: "general-purpose"`, `run_in_background: true`.
- `name` per persona: `architect`, `staff-engineer`, `devils-advocate`,
  `security-auditor`. These names are how the verifier addresses them via
  `SendMessage`.

Each prompt must:

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
8. **Write the final report to `/tmp/pr-<NUMBER>/panel/<role>.md`** (e.g.
   `architect.md`) as its last action, then return the same text. The verifier
   reads these files; the on-disk copy keeps the verifier's prompt small and
   survives the background handoff.

**Fallback if agent teams are unavailable** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`
unset): drop `name` / `run_in_background`, dispatch the four plainly in one
message, and in Phase 2 skip the SendMessage challenge round — the verifier
still fact-checks from the on-disk reports, just without the defend-or-retract
loop.

Why solutions are required: a flagged risk without a proposed direction
pushes synthesis work onto the user. The personas are senior enough to
recommend a fix or explicitly say "needs design discussion" when they can't.
"Consider improving X" is not a fix — it's a restatement of the problem.

Persona prompt scaffolds follow. Adjust **Context** and file list per PR; keep
the structural directives (output format, word budget, no-nits rule) intact.
Append directive 8 to each scaffold's closing line: "Write this report to
`/tmp/pr-<N>/panel/<role>.md` before returning."

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

## Phase 2 — Independent verification

The panel is fast and confident, which means it also fabricates: wrong line
citations, severity inflation, "fixes" that restate the problem, the occasional
hallucinated finding. Before anything reaches the user, an independent verifier
fact-checks the panel against the actual diff. The verifier is **not** a fifth
reviewer — it adds no findings of its own; it only adjudicates the panel's.

### Step 3. Dispatch the verifier

When all four background panelists have returned (their reports are on disk),
dispatch **one** verifier — `subagent_type: "general-purpose"`,
`name: "verifier"`. It reads the diff and the four panel files, not your
summary. Scaffold:

```
You are an Independent Review Verifier for PR #<N> on <OWNER/REPO>. Four
panelists already reviewed this PR. Your ONLY job is to fact-check their
findings against the diff — do NOT introduce findings of your own.

## Inputs
- Diff: /tmp/pr-<N>/diff.patch
- Panel reports: /tmp/pr-<N>/panel/architect.md, staff-engineer.md,
  devils-advocate.md, security-auditor.md

## Your job
For EVERY numbered finding across all four reports:
1. Locate the cited file/line in the diff (grep / read it). Confirm the code
   the finding describes actually exists and behaves as claimed.
2. Assign a verdict:
   - VERIFIED — accurate; the cited location supports the claim.
   - OVERSTATED — real issue, but severity/impact/scope is exaggerated.
   - UNSUPPORTED — citation is wrong, the code doesn't say what's claimed, or
     the finding is speculative/hallucinated.
   - NIT — true but it's the style/naming/micro-refactor the panel was told to
     exclude.
   - FIX-WEAK — finding is valid but the proposed fix restates the problem
     ("handle the race") or wouldn't actually work.
3. Give one line of evidence per verdict (the diff line you checked + what you
   found there).

Output a single table: Reviewer · Finding (short) · Verdict · Evidence. Then
one line listing which findings MUST be dropped (UNSUPPORTED) or downgraded
(OVERSTATED / NIT / FIX-WEAK) before this report goes to the user. Add nothing
else — no new findings, no restating the diff.
```

### Step 4. Challenge weak findings back to their author

For each finding the verifier marks **UNSUPPORTED** or **OVERSTATED**,
`SendMessage` the originating panelist by name (`architect`, `staff-engineer`,
etc.) — their review context is intact, so this is cheap. Quote the verifier's
objection and ask them to **defend with a specific diff citation or retract**.
Keep it to **one** round per finding; this is adjudication, not a debate club.

- Panelist defends with a valid citation → keep the finding, note it survived
  challenge.
- Panelist retracts or can't cite → drop it from the consolidation.

If agent teams are unavailable (fallback path), skip this step and treat the
verifier's verdict as final: drop UNSUPPORTED, downgrade the rest.

## Phase 3 — Consolidate

### Step 5. Consolidate into one report

When the panel, verifier, and any challenge rounds are settled, synthesize —
don't just paste the four blocks. Carry each finding's recommended fix inline
(verbatim or refined), and annotate it with the verifier's verdict; drop the
findings the verifier killed. Layout:

```
## 🏛️ Architect — strategic shape
<surviving numbered findings, each tagged [verified]/[overstated] and ending
 with "**Fix:** ...">

## 🛠️ Staff Engineer — operational risk
<surviving numbered findings, each tagged and ending with "**Fix:** ...">

## 😈 Devil's Advocate — challenge the premise
<surviving numbered objections, each tagged and ending with "**Alternative:** ...">

## 🔒 Security Auditor — exploitable risk
<surviving numbered findings, each led by severity, tagged, ending with "**Fix:** ...">

## 🎯 Cross-cutting consensus
<which findings did 2+ agents converge on? what's the single decision to
force before merging? — name the concrete action, not the abstract concern>

## ✅ Verification
<what the verifier caught: findings dropped as UNSUPPORTED, downgraded as
OVERSTATED/NIT/FIX-WEAK, and which survived a challenge round. One line each.
This is the user's trust signal — it tells them what the panel got wrong, not
just what it got right.>

## 📋 Suggestions digest
<flat table of every surviving fix, grouped by reviewer, so the user can
scan/act without re-reading the narrative. Columns: Finding · Recommended
fix. Include must-fix-before-merge and follow-up items separately if the
staff engineer flagged them.>
```

Both the consensus and the digest are the highest-value part of the output:
consensus tells the user what to act on first; the digest is what they paste
into a tracking ticket or review thread. Look for the same concern surfacing
in different language across reports and merge identical fixes.

## Phase 4 — Drill-down on a specific finding

After the report lands, the user often picks one finding and asks "where can
we do that?" or pastes a finding back. Don't re-dispatch agents — answer
yourself from the saved diff (the verifier already confirmed the citation, so
trust the on-disk reports):

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

Before reporting completion of the review:

- [ ] Diff was fetched once to `/tmp/pr-<N>/diff.patch`, not four times.
- [ ] All four Agent calls were sent in a single message (parallel), each a
      named background teammate (`architect`, `staff-engineer`,
      `devils-advocate`, `security-auditor`).
- [ ] Each agent prompt named its persona, included PR Context, pointed at the
      saved diff, required a recommended fix per finding, capped output at the
      word budget, and wrote its report to `/tmp/pr-<N>/panel/<role>.md`.
- [ ] A single independent **verifier** ran after the panel, fact-checked every
      finding against the diff, and added **no** findings of its own.
- [ ] Findings the verifier marked UNSUPPORTED/OVERSTATED were challenged back
      to their author via `SendMessage` (one round); retracted/uncitable ones
      were dropped, not silently kept.
- [ ] Every surviving finding ships with a concrete **Fix** / **Alternative** —
      not "consider improving X," not "handle the race." If an agent left one
      naked, add the fix yourself from the diff or mark it "needs design
      discussion" with what's unclear.
- [ ] The consolidated report has all four reviewer sections, a cross-cutting
      consensus paragraph, a **✅ Verification** section, **and** a Suggestions
      digest table.
- [ ] The consensus paragraph names a concrete decision to force (e.g. "name
      an owner for the bridge contract and extract it to a typed package"),
      not an abstract concern.
- [ ] Findings cite file paths (and diff-line numbers when claiming a bug).
- [ ] No agent's output is pure style nitpicks — if one drifted, redirect or
      drop it from the consolidation rather than pasting noise.

For Phase 4 drill-downs:

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
- **Skipping verification.** The panel is confident and wrong often enough that
  shipping its raw output undoes the point. Always run the verifier before
  consolidating; the ✅ Verification section is the trust signal.
- **Verifier inventing findings.** The verifier adjudicates the panel only. If
  it starts adding its own review notes, it's a fifth reviewer with no
  fact-checker — redirect it to verdicts + evidence.
- **Treating the verifier as the final word without challenge.** When teams are
  available, an UNSUPPORTED verdict goes back to the author for one round — the
  panelist may have a citation the verifier missed. Drop only what stays
  uncited.
- **Drilling down by re-dispatching.** Phase 4 doesn't need new agents — the
  diff is on disk and you have the finding text.
- **Findings without fixes.** "Consider improving error handling" and "handle
  the race" are not fixes. If an agent returns a bare finding, attach the
  fix yourself from the diff, or mark it "needs design discussion" with the
  specific open question. Don't pass diagnosis-only work back to the user —
  that's what this skill is supposed to prevent.
