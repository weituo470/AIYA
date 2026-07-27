# AI 编程老师 Agent · Hermes 直接写代码方案

## 当前决策

`/create-theatre` 的老师不再只是“讲解 + 委托生成器”。老师本身就是 Coding Agent：

- 页面入口：`/create-theatre`
- 聊天接口：`/api/teacher-agent`
- 写代码接口：`/api/teacher-coder`
- 推理底座：优先使用 Hermes 兼容模型通道
- 交付形态：老师直接返回完整单文件 HTML，页面立即进入试玩

## 第一版目标

1. 用户用文字或语音说出想法。
2. 老师先用自然语言回应，并在同一轮启动写代码。
3. `/api/teacher-coder` 直接生成或修改完整 `index.html`。
4. 多轮修改时把当前 HTML 传回老师，要求增量修改，不丢失已有功能。
5. 返回结果后进入试玩、源码、验证三个视图。

## 老师 Agent 边界

老师负责：

- 引导新手说清楚目标。
- 直接创建或修改单文件 HTML/CSS/JS。
- 用中文解释已经完成的功能。
- 在等待过程中继续和学生对话。
- 根据学生昵称、声纹状态避免重复提问。

老师暂不负责：

- 多文件工程生成。
- npm / Vite / React 项目初始化。
- 复杂自动化测试与质量打分。
- 后台部署、账号权限、生产数据库管理。

## Hermes 环境变量

推荐使用专用变量，避免和旧的 Create Runner 通道混用：

```env
AIYA_TEACHER_CODER_BASE_URL=http://127.0.0.1:1234
AIYA_TEACHER_CODER_API_TYPE=openai
AIYA_TEACHER_CODER_API_KEY=lm-studio
AIYA_TEACHER_CODER_MODEL=your-hermes-model

AIYA_TEACHER_AGENT_BASE_URL=http://127.0.0.1:1234
AIYA_TEACHER_AGENT_API_TYPE=openai
AIYA_TEACHER_AGENT_API_KEY=lm-studio
AIYA_TEACHER_AGENT_MODEL=your-hermes-model
```

也可以使用统一的 Hermes 变量：

```env
HERMES_BASE_URL=http://127.0.0.1:1234
HERMES_API_TYPE=openai
HERMES_API_KEY=lm-studio
HERMES_MODEL=your-hermes-model
```

如果 Hermes 是 Anthropic 兼容接口：

```env
HERMES_API_TYPE=anthropic
```

## 当前验证策略

第一版只做必要安全拦截：

- 禁止外部脚本、外部 CSS、iframe。
- 禁止 `fetch`、`XMLHttpRequest`、`WebSocket`。
- 禁止 `http://` / `https://` 外链。
- 要求返回完整 HTML，并包含内联 `<script>`。

不再让旧的质量分机制阻塞交付。后续如需恢复验证，应做成可选的后台复检，而不是拖慢学生首次看到作品的速度。

## 后续路线

1. 收集真实“老师直接写代码”的对话与 HTML 产物。
2. 标注高质量案例：需求澄清、首次生成、增量修改、失败修复、鼓励反馈。
3. 形成 Hermes 老师专用提示词与少量示例库。
4. 再考虑 SFT / LoRA。
5. 微调前保持 prompt-first，避免过早训练错误行为。
