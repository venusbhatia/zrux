# MEMORY.md  zrux

This file is auto-managed by Claude Code. It is populated after real sessions via the /memory command.
Do not manually edit it. Do not duplicate anything already in CLAUDE.md.
Claude writes what it learns here. You write standing orders in CLAUDE.md.

---

<!-- Claude Code will begin writing below this line after the first few sessions. -->

## Standing rule: Greptile code review gate (every PR)

Greptile (`greptile-apps[bot]`) auto-reviews every PR. Treat its review as a
merge gate, not advisory.

- **Do not merge any PR until it is 5/5** — i.e. every Greptile **P1** comment is
  resolved, and every **P2** is either fixed or has a written, defensible reason
  to defer left as a reply on the comment. Address security-tagged comments
  always.
- Each Greptile comment carries a priority badge: **P1** = high (necessary, must
  fix), **P2** = medium (fix unless there is a deliberate reason not to), lower =
  judgment call.
- After pushing fixes, re-request review / let Greptile re-run, and confirm the
  new review is clean before merging.
- Fetch comments with:
  `gh api repos/venusbhatia/zrux/pulls/<n>/comments` (inline) and
  `gh api repos/venusbhatia/zrux/issues/<n>/comments` (summary/score).
- Workflow: every major change -> feature branch -> PR into `main` -> Greptile
  5/5 -> merge. `main` is the default branch.
