# AIYA Create V0 产品方案

## 1. 一句话定义

AIYA Create 是 AIYA 生态中的应用创作入口：用户用一句话描述想法，AIYA 调度 Builder Agent 生成一个可运行的小应用或小游戏，并在浏览器沙盒中立即预览、修改、学习和分享。

## 2. 产品边界

AIYA 平台负责：身份、通讯、Agent 调度、作品预览、作品版本、分享、发布、治理。

Builder Agent 或外部开发 Agent 负责：理解需求、生成代码、解释代码、按用户反馈修改。

这保证 AIYA 不变成单一代码生成器，而是成为普通人进入软件创造生态的第一站。

## 3. V0 场景

目标场景：一句话生成简单应用或小游戏，并在手机/电脑上当场看到效果。

V0 is now fail-fast: generation must go through the server Codex Runner and Playwright validation; mock/local-template fallback is disabled.

- 小游戏：贪食蛇、躲避、跑酷、打怪、抽奖互动等，由模型根据输入理解生成。
- 小工具：番茄钟、记账、任务清单、计算器。
- 轻页面：祝福页、活动页、学习演示页。

## 4. 用户流程

1. 用户进入 `/create`。
2. 输入一句话想法，例如“做一个太空躲避陨石小游戏”；也可以点击“语音输入”，直接说出想法。
3. AIYA 生成单文件 Web 应用。
4. 页面用 sandbox iframe 立即预览。
5. 用户继续输入修改要求，例如“加一个排行榜”。
6. AIYA 将当前版本的 `index.html` 与修改要求一起交给 Builder 模型，生成完整新版本。
7. 用户复制分享链接；V1 支持发布到 AIYA Gallery。

## 5. 页面结构

- Hero：一句话承诺，强调“想法到可运行结果”。
- Prompt Panel：一句话输入、语音输入、示例、修改指令、生成按钮。
- Preview Panel：iframe 沙盒预览生成应用。
- Inspector：教学解释、文件说明、发布路径。

视觉基调：深空创造台。用户的一句话像点燃一个小宇宙，右侧马上出现可运行作品。

## 6. 数据模型草案

### GeneratedApp

| 字段 | 说明 |
| --- | --- |
| id | 应用 ID |
| ownerPrincipalId | 创建者 Principal |
| title | 应用标题 |
| prompt | 初始需求 |
| category | mini_game / utility / page / education |
| status | draft / published / archived |
| latestVersionId | 当前版本 |
| thumbnailUrl | 缩略图 |
| createdAt / updatedAt | 时间戳 |

### AppVersion

| 字段 | 说明 |
| --- | --- |
| id | 版本 ID |
| appId | 所属应用 |
| version | 版本号 |
| prompt | 本轮修改要求 |
| filesJson | 文件集合，V0 可只有 index.html |
| generatorAgentId | 生成 Agent |
| buildStatus | success / failed / blocked |
| safetyStatus | pending / passed / rejected |
| createdAt | 创建时间 |

## 7. API 设计草案

```http
POST /api/create/generate
POST /api/apps/generate
GET /api/apps/:id
PATCH /api/apps/:id
POST /api/apps/:id/versions
POST /api/apps/:id/publish
GET /api/apps/gallery
```

`/api/create/jobs` is the default generation channel. The frontend submits `prompt`, optional `revision`, and optional `currentApp`; the runner must return a complete validated `{ title, kind, brief, html, teaching, nextEdits }`. If Codex, validation, or result normalization fails, the UI shows the real error and does not replace the preview with a mock/fallback demo.

服务端环境变量：

- `AIYA_CREATE_MODEL_BASE_URL`
- `AIYA_CREATE_MODEL_API_KEY`
- `AIYA_CREATE_MODEL`

Current Create generation requires a real Codex command in `apps/create-runner/.env`; Ollama/model fallback flags are not part of the user-facing path.

V0 不依赖数据库；V1 再接入作品 API、持久化与 Agent 编排。

## 8. 安全策略

V0 只允许生成前端单文件应用：

- iframe 使用 `sandbox="allow-scripts"`。
- 不允许 `allow-same-origin`，避免访问 AIYA 登录态。
- 不执行后端代码。
- 不注入用户 token、API key、数据库连接信息。
- 默认不开放任意外部网络请求。
- 发布前增加静态扫描和人工/Agent 审核。

## 9. 教学机制

每个生成结果都要解释“它是怎么做出来的”：

- 小白层：这个应用由哪些部分组成。
- 实用层：如何改文字、颜色、速度、规则。
- 代码层：HTML/CSS/JS 分别做什么。

教学围绕用户自己的作品发生，而不是先让用户上抽象课程。

## 10. 推广机制

V1 引入 AIYA Gallery：

- 作品发布页。
- 创作者主页。
- Remix 按钮。
- Prompt 来源展示。
- Created with AIYA 标识。
- 点赞、收藏、评论、分享。

长期可演进为模板市场、教学课程市场、Agent 能力市场。

## 11. 验收标准

V0 完成标准：

- `/create` 页面可访问。
- 输入任意明确的一句话应用/小游戏需求后，优先由模型实时生成可运行 demo，不要求用户继续补充需求。
- When Codex or validation is unavailable, show the exact error and keep the last verified preview; do not generate or display a local fallback demo.
- 支持在已生成项目上继续输入修改要求，生成新版本，并保留版本历史与回退能力。
- 生成结果在 iframe 内运行。
- 手机尺寸可读可操作。
- 支持一次修改再生成。
- 支持复制分享链接。
- 支持语音输入想法；不支持语音识别的浏览器显示降级提示。
- 不暴露任何密钥、token 或内部路径。
- `pnpm --filter @aiya/web typecheck` 与 `pnpm --filter @aiya/web build` 通过。

## 12. 版本路线

- V0: server Codex Runner + fail-fast validation + sandbox preview + revision workflow + share entry. No mock/fallback for submitted generation jobs.
- V1：Builder Agent 编排 + 数据库存储 + 版本管理 + Gallery。
- V2：Remix、创作者主页、作品流、移动端优化。
- V3：模板市场、Agent 能力市场、商业化分发。


## 2026-06-29 Quality Gate Update

- Current local generation model is configured in `apps/web/.env.local` through the DeepPraxis OpenAI-compatible router:
  - `AIYA_CREATE_MODEL_BASE_URL=https://api.deepraxis.ai/v1/router/openai/v1`
  - `AIYA_CREATE_MODEL=deepseek-v4-flash`
  - API key is local-only and must not be committed or printed.
- `/api/create/generate` now performs post-generation QA instead of directly trusting the model output:
  - safety scan for external scripts/CSS/network/storage/form usage;
  - runtime guard injection for Arrow/WASD/Space scroll conflicts in sandbox previews;
  - game QA for canvas/game loop/score/interactions/mobile controls;
  - snake-specific QA for snake theme, visible food, keyboard directions, mobile buttons, score, boundary, and first-screen state;
  - up to two repair attempts before rejecting the result.
- If a game prompt fails QA, the frontend keeps the current version and shows an error instead of silently falling back to an unrelated local template.
- Verification evidence:
  - `pnpm --filter @aiya/web typecheck` passed.
  - `pnpm --filter @aiya/web build` passed.
  - `node test-results/aiya-create-v0/verify-snake-quality.mjs` currently returns HTTP 422 for `??????` because `deepseek-v4-flash` repeatedly generated a first-screen game-over snake. This is intentional fail-closed behavior until a stronger model is configured.

### Known model-quality limitation

`deepseek-v4-flash` is fast but not reliable enough for one-shot playable game generation. It can produce malformed JSON, wrong game themes, or code that statically looks complete but fails playability checks. For production AIYA Create, use a stronger coding model route and keep the QA/repair gate enabled.


## 2026-06-29 Server Codex Runner Architecture

AIYA Create now has a first implementation of the planned server-side job pipeline.

### Runtime shape

- `apps/create-runner` is a standalone Fastify service.
- Web users do not call the code generator directly. The Web app creates a job through `/api/create/jobs`, then polls `/api/create/jobs/:id`.
- The runner owns isolated workspaces under `.state/create-runner/workspaces/<jobId>` and writes validation artifacts there.
- `AIYA_CREATE_CODEX_COMMAND` is required. The runner invokes that command in the job workspace and expects `index.html` as output.
- If the command is missing or `AIYA_CREATE_CODEX_MODE=mock`, the job fails explicitly; deterministic local fallback has been removed.

### Validation

Each generated HTML result is normalized, runtime-guarded, and checked in two layers:

1. Static safety/structure checks:
   - no external scripts, CSS, images, network calls, storage, cookies, or forms;
   - size limits;
   - game structure checks;
   - snake-specific checks for food, direction controls, and non-game-over first screen.
2. Playwright execution checks:
   - load result inside a sandbox iframe;
   - capture console/page errors;
   - verify a canvas or game root exists;
   - simulate Arrow key input;
   - confirm host scroll does not move;
   - save a screenshot artifact.

### Local commands

```powershell
pnpm install
pnpm create-runner
pnpm --filter @aiya/web dev
```

Smoke test:

```powershell
pnpm test:create-runner
```

### Web behavior

`/create` now keeps the current preview until a Codex Runner job succeeds. Failed jobs show validation failures and do not replace the iframe with a bad demo.
