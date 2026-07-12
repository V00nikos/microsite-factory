# Microsite Factory

Hermes-agent-powered system: paste a B2B account list, get one research-grade
personalized microsite per account, with a QA gate on every pipeline stage and
an eval trace behind every decision.

- Agent behavior: `CLAUDE.md` (rules + frozen contracts) and `skills/*/SKILL.md`
- Full spec: `docs/microsite-factory-prd.md` · Build sequence: `docs/BUILD_TASKS.md`

## Layout

```
CLAUDE.md                    rules + frozen data contracts
docs/                        PRD + build tasks
skills/                      distributor · account-researcher · microsite-builder · qa-reviewer
scripts/install-skills.sh    installs skills into ~/.hermes/skills (repo = source of truth)
convex/                      schema, queries, HTTP actions        (Task 1)
frontend/                    SPA on Cloudflare Pages              (Task 5)
sites/                       generated microsites (gitignored)
memory/positioning.template.md  seed for the worker profile's positioning memory
```

## Workflow rules

1. Edit skills in `skills/`, then run `scripts/install-skills.sh` — never edit
   `~/.hermes/skills/` directly.
2. After any skill edit: reinstall → one-account end-to-end test → read traces
   → then proceed.
3. Secrets live in `.env` / `~/.hermes/.env` (see `.env.example`); humans manage
   them, agents never print or edit them.
