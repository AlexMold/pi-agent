---
name: verify-before-merge
description: After every implemented feature or bug fix, run lint + typecheck + tests to ensure nothing is broken before wrapping up. Use when the task involves code changes.
---

# Verify Before Merge

After implementing any feature or bug fix, **always run the full verification pipeline** before declaring done. This catches regressions early and keeps CI green.

## Pipeline (run in order)

### 1. Lint

Check code style and catch unused variables or obvious errors:

```bash
npm run lint
```

If lint fails, fix the reported issues before proceeding. The project uses ESLint 10 with flat config (`eslint.config.js`).

### 2. TypeScript typecheck

Ensure type safety and catch interface mismatches:

```bash
npx tsc --noEmit
```

If `tsc` emits errors, fix them — they will break the build. Pay attention to:
- Missing or mismatched imports
- Incorrect return types
- `any` casts that hide real issues

### 3. Tests

Run the full test suite:

```bash
npm test
```

The project uses **vitest** with 32+ tests across 3 test files:
- `src/tests/router.test.ts` — SmartRouter keyword routing and token counting
- `src/tests/chat-queue.test.ts` — per-chat preemptive message queue
- `src/tests/bot-e2e.test.ts` — end-to-end bot orchestration (mock-based)

**All tests must pass.** If any fail:
1. Read the failure output carefully
2. Fix the code or update the test if the behaviour has intentionally changed
3. Re-run `npm test` to confirm

## Verification checklist

After all three steps pass, confirm:

- [ ] `npm run lint` — no errors or warnings
- [ ] `npx tsc --noEmit` — clean exit (no output)
- [ ] `npm test` — all tests pass

## Pro tips

- **Watch mode**: during development use `npm run test:watch` to get instant feedback
- **Single test file**: `npx vitest run src/tests/bot-e2e.test.ts` to run only e2e tests
- **Single test**: `npx vitest run src/tests/bot-e2e.test.ts -t "preemption"` to run a specific test by name pattern
- **Coverage**: `npm run test:coverage` to see which lines aren't tested

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `tsc` shows errors in mock/test files | Mock doesn't match actual module interface | Update the mock or the interface |
| `vitest` hangs or times out | Fake timers not restored (`vi.useRealTimers()`) | Ensure every `vi.useFakeTimers()` has a matching restore |
| `eslint` can't find config | Wrong working directory | Always run from project root |
