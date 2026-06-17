---
description: Review recent changes against CLAUDE.md conventions and the assignment requirements
tools: Read, Bash
---

Review the current git diff against our conventions and the assignment requirements.

Run: git diff HEAD and git diff --staged

Then check every changed file against these rules from CLAUDE.md. Report only real violations, not style opinions.

HARD RULES (flag any violation):

- Every Supabase query must have user_id in the WHERE clause. No exceptions.
- No source API calls (Gmail, Linear, Slack, etc.) inside any file under app/api/answer/. That path is read-only from Postgres.
- No ingestion logic inside Next.js API routes. Ingestion lives in trigger/ or lib/ingestion/.
- Triple extraction must only be called for high-signal sources: email, calendar, Notion, Linear, meetings. If it is called for Slack or Sentry, flag it.
- Both source_created_at and source_updated_at must be present on every context_item insert. A single occurred_at is a bug.
- No hardcoded strings that look like API keys, tokens, or secrets.
- No default exports except in app/ page files.
- No .then() promise chains. Async/await only.
- No em dashes anywhere in UI copy or comments.
- pnpm only. If package.json scripts or any file references npm or yarn, flag it.

ASSIGNMENT REQUIREMENTS (check these):

- Does the answer path return cited sources with every response?
- Is the synthesis prompt instructing the model to be read-only (no side-effecting tools)?
- Is the retrieval grounded in stored context, not live API calls?

For each violation found: name the file, the line number, what the violation is, and the one-line fix.
For each area with no violations: one line saying it is clean.

End with a summary: X violations found, Y areas clean. Ready to commit: yes or no.

If ready to commit, suggest a commit message in this format:
feat/fix/chore/test: [one line describing what changed]

Then remind me to:

1. git add -A
2. git commit -m "[suggested message]"
3. git push origin [current branch]

If this is a meaningful working state (something new works end to end, a bug is fixed, a migration ran clean), also suggest creating a new branch for the next chunk of work.
