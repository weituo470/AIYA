# AIYA 异常收集与任务失败复盘机制

## 目标

每次生成任务、老师对话、create-runner 代理失败时，必须留下可复盘日志，避免只看到“失败/Not Found/502”而不知道原因。

## 日志落点

默认写入：

```text
.state\diagnostics\YYYY-MM-DD.jsonl
```

可通过环境变量改位置：

```env
AIYA_DIAGNOSTICS_DIR=/opt/aiya/.state/diagnostics
```

每行是一个 JSON 事件，核心字段：

- `id`：诊断 ID，前端错误会显示这个 ID。
- `scope`：失败来源，例如 `teacher-coder`、`teacher-agent`、`create-runner-proxy`、`client-report`。
- `status`：`succeeded` 或 `failed`。
- `route`：对应 API 路由。
- `message`：人类可读错误。
- `durationMs`：耗时。
- `model/provider/apiType`：模型通道。
- `data.error.stack`：服务端堆栈。
- `data.detail`：模型原始输出摘要、上游响应摘要、HTML 检查结果等。

敏感字段如 API key、token、authorization、cookie 会自动脱敏。

## 查询接口

开发环境：

```bash
curl "http://127.0.0.1:3333/api/admin/diagnostics?limit=20"
curl "http://127.0.0.1:3333/api/admin/diagnostics?id=<诊断ID>"
curl "http://127.0.0.1:3333/api/admin/diagnostics?scope=teacher-coder&status=failed"
```

生产环境建议配置：

```env
AIYA_DIAGNOSTICS_TOKEN=change-me
```

然后查询：

```bash
curl "https://aiya.shenliu.cc/api/admin/diagnostics?limit=20" \
  -H "x-aiya-admin-token: change-me"
```

如果生产环境没有配置 token，接口会拒绝访问，避免泄露学生输入和错误细节。

## 已接入范围

1. `/api/teacher-coder`
   - 记录模型通道、输入摘要、当前作品哈希、上游响应、解析失败原因、HTML 缺失项、堆栈。
2. `/api/teacher-agent`
   - 记录老师对话失败、学生档案摘要、模型通道、堆栈。
3. `/api/create/jobs*`
   - 记录 create-runner 不可用、任务不存在、事件流失败、runner 返回非 2xx。
4. `/api/diagnostics/client`
   - 记录浏览器侧任务失败，例如 fetch 失败、前端 catch 到的生成失败。

## 交付标准

遇到任务失败时，页面/接口应至少给出：

```text
诊断ID：teacher_coder_...
```

排查时先按 ID 查日志，再看：

1. `message`
2. `data.detail`
3. `data.error.stack`
4. 上游模型响应摘要或 create-runner payload
5. 对应 jobId / prompt / currentApp 哈希

这样可以判断是模型输出问题、网关问题、代码解析问题、任务配置问题，还是浏览器端问题。
