# AI Workflow Rules

## Approach

Build Hunter incrementally using a spec-driven workflow. The context files in `docs/context/` define what to build, how to build it, and the current state of progress. The implementation steps in `docs/job-automation-implementation new.md` define the exact phase order with complete code. Always implement against these specs — do not infer or invent behavior from scratch. If a requirement is missing or ambiguous, resolve it in the relevant context file before writing code.

## Scoping Rules

- Work on one phase at a time in the order defined in the implementation plan
- Prefer small, verifiable increments over large speculative changes
- Do not combine unrelated system boundaries in a single implementation step (e.g. do not add Foundit while Naukri is still failing its test)
- Each portal phase must pass its test checklist before the next portal phase begins

## When to Split Work

Split an implementation step if it combines:

- A portal client change AND a frontend change
- Multiple unrelated portals (implement one portal per step)
- A new API route AND a scheduler change
- Any behavior that cannot be verified end-to-end quickly (running the test script or hitting the API)

If a change cannot be verified end to end quickly, the scope is too broad — split it.

## Handling Missing Requirements

- Do not invent product behavior not defined in the context files or implementation plan
- If a portal API endpoint or selector is unknown, verify it from DevTools before writing code — do not guess
- If a requirement is ambiguous, resolve it in the relevant context file (`project-overview.md`, `architecture.md`) before implementing
- If a requirement is missing, add it as an open question in `progress-tracker.md` before continuing

## Protected Files

Do not modify the following unless explicitly instructed:

- `core/encryption.py` — security-critical; any change requires explicit review
- `portals/base.py` (`SafeApplyManager`) — rate limit logic; changes can cause account bans
- `portals/naukri/jobs.py` (`Job` dataclass) — shared across all portals; field changes are breaking

## Keeping Docs in Sync

Update the relevant context file whenever implementation changes affect:

- System architecture or module boundaries → `architecture.md`
- Storage model decisions (new tables, new columns) → `architecture.md`
- Code conventions or tool choices → `code-standards.md`
- Feature scope changes → `project-overview.md`
- UI design decisions → `ui-context.md`
- Any completed, in-progress, or blocked work → `progress-tracker.md`

## Before Moving to the Next Phase

1. The current portal test script fully passes (login → search → at least one apply)
2. No architecture invariant defined in `architecture.md` was violated
3. `progress-tracker.md` reflects the completed work and any decisions made
4. `npm run build` passes (for frontend phases)
5. The daily limit and delay logic in `SafeApplyManager` covers the new portal

## Portal Implementation Checklist Template

Copy this into `progress-tracker.md` for each new portal:

```
- [ ] DevTools study complete — endpoints captured
- [ ] Auth client written and tested (login returns valid token)
- [ ] Job search returns at least 10 results
- [ ] Apply to 1 real job works end to end
- [ ] Rate limit registered in SafeApplyManager (base.py)
- [ ] Portal connected in scheduler (daily_fetch.py)
- [ ] API route for token/setup added and tested
- [ ] Frontend portal card shows correct connected/expired state
```
