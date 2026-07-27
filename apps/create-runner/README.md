# AIYA Create Runner

Standalone Build Mode job service for AIYA Create.

The runner accepts create jobs, creates an isolated workspace, copies a verified template, writes `ProductSpec.md`, invokes the real Codex CLI inside that template, runs executable validation, and returns only validated preview HTML.

## Local start

```powershell
pnpm --filter @aiya/create-runner dev
```

Default port: `3334`.

## Build Mode pipeline

1. Create isolated workspace under `AIYA_CREATE_RUNNER_WORK_DIR`.
2. Copy `templates/game-canvas-basic`.
3. Write `ProductSpec.md` from the user prompt/revision.
4. Invoke `AIYA_CREATE_CODEX_COMMAND` inside the template workspace.
5. Validate with:
   - `pnpm install --ignore-workspace`
   - `pnpm typecheck`
   - `pnpm lint`
   - `pnpm test -- --run`
   - `pnpm build`
   - `pnpm smoke`
6. Write `artifacts/attempt-<n>/ValidationReport.json`, `commands.log`, and screenshot.
7. Run semantic checks for game essentials; Snake requests additionally require snake/food/score/collision/control/restart signals.
8. If validation fails, send the report back to Codex for a minimal repair, up to `AIYA_CREATE_REPAIR_ATTEMPTS`.
9. On success, inline Vite `dist` assets into `validated-index.html` for the `/create` iframe preview.

## No mock / no fallback

Mock and local-template fallback generation are intentionally disabled.

- Missing `AIYA_CREATE_CODEX_COMMAND` fails the job.
- `AIYA_CREATE_CODEX_MODE=mock` fails the job.
- The old direct model route `/api/create/generate` is disabled on the Web side.

## Required Codex adapter

```env
AIYA_CREATE_CODEX_MODE=auto
AIYA_CREATE_CODEX_COMMAND=codex
AIYA_CREATE_CODEX_ARGS=exec --model gpt-5.5 --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules --color never -
AIYA_CREATE_CODEX_MODEL_LABEL=codex-cli/gpt-5.5
AIYA_CREATE_JOB_TIMEOUT_MS=600000
```

Each Codex attempt writes `CodexRun-<attempt>.log` in the job app workspace. On timeout, the runner kills the full process tree on Windows before failing the job. The Codex process runs in a per-job isolated workspace with approvals/sandbox bypassed so file edits are not blocked by nested Codex sandboxing.

## API

- `GET /health`
- `POST /jobs` with `{ prompt, revision?, currentApp? }`
- `GET /jobs/:id`
- `GET /jobs/:id/events` server-sent events

## Smoke

`pnpm test:create-runner` validates the baseline template and artifact pipeline without invoking Codex. It is not a generation fallback.
