<p align="center">
  <img src="apps/android-v3/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png" width="128" alt="AIYA Logo" />
</p>

<h1 align="center">AIYA · AI 编程入门</h1>

<p align="center">让没有接触过编程的人，用一句话或一段语音，把想法变成可以试玩、继续完善并带走的作品。</p>

<p align="center">
  <a href="https://aiya.shenliu.cc/create-theatre">在线体验 V2</a> ·
  <a href="https://aiya.shenliu.cc/downloads/aiya-v3-debug.apk">下载 V3 Android APK</a> ·
  <a href="docs/product/aiya-ai-curriculum-design.html">查看课程设计</a>
</p>

> 所有伟大，都源于一次勇敢的开始。创造是一种高级的乐趣。

## 项目是什么

AIYA 是一个面向 AI 编程启蒙的开源项目。它不要求初学者先学习语法，而是先经历完整的创造闭环：

1. **创作**：输入或说出一个应用想法。
2. **生成**：AI 老师理解需求、估算时间并生成单文件 Web Demo。
3. **试玩**：在浏览器或 Android WebView 中立即验证交互效果。
4. **迭代**：继续描述修改要求，保留项目与版本。
5. **带走**：查看源码、下载 HTML，或由服务端构建可安装 APK。

代码可以查看，但启蒙阶段不强迫用户手工修改。目标是先建立兴趣、需求表达能力、验证意识和继续学习的路径。

## 本次代码更新 · V3 0.6.70

- Web 增加「金钥匙」提示词和后续强化选项，区分电脑与手机使用场景。
- 任务轨迹展示生成路线、实际模型、耗时、故障转移和验证覆盖范围；对话支持复制与等待计时。
- 构建链路加入有限预算、任务恢复、隔离浏览器验证及最多一次定向修复。冒烟检查不等于完整功能验收。
- 模型入口包含 DeepSeek、GPT 和实验性 Fusion；Fusion 流式传输代码已加入，但不代表供应方性能或稳定性已得到保证。
- 固定老师语音可复用缓存，减少重复合成。
- Android 修复 SVG 命名空间误判造成的连续闪退；被拒绝的作品显示可恢复提示，不清除原作品。

这是源码更新，不等于线上服务或 APK 自动更新通道已发布。配置说明见 [构建与验证](docs/product/build-and-validation.md)。

## 产品截图

<table>
  <tr>
    <td width="33%"><img src="apps/web/public/investors/aiya-2026/screen-create.webp" alt="创作页面" /></td>
    <td width="33%"><img src="apps/web/public/investors/aiya-2026/screen-calculator.webp" alt="试玩页面" /></td>
    <td width="33%"><img src="apps/web/public/investors/aiya-2026/screen-export.webp" alt="带走页面" /></td>
  </tr>
  <tr><td align="center">创作</td><td align="center">试玩</td><td align="center">带走</td></tr>
</table>

## 仓库结构

```text
apps/
  web/             Next.js：V2 Web、生成 API、管理后台与课程页面
  android-v3/      Kotlin + Jetpack Compose：原生移动端三 Tab 应用
  apk-builder/     将单文件 HTML 包装成 Android APK
  create-runner/   隔离工作区中的生成与校验任务服务
  dev-runner/      可选的开发终端服务
packages/
  database/        Prisma 数据模型与迁移
docs/              产品、课程、安全与诊断文档
```

## 快速开始

### 运行环境

- Node.js 20+
- pnpm 10.16+
- PostgreSQL 15+
- Android Studio / JDK 17（仅构建 V3 APK 时需要）

### 1. 安装依赖

```bash
git clone https://github.com/weituo470/AIYA.git
cd AIYA
pnpm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
cp .env.example apps/web/.env.local
```

至少配置：

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aiya
AIYA_TEACHER_CODER_BASE_URL=https://api.openai.com/v1
AIYA_TEACHER_CODER_API_KEY=your-api-key
AIYA_TEACHER_CODER_MODEL=your-model-name
CREATE_THEATRE_ADMIN_TOKEN=replace-with-a-long-random-token
CREATE_THEATRE_MODEL_OPERATION_PASSWORD=replace-with-a-strong-password
CREATE_THEATRE_SETTINGS_ENCRYPTION_KEY=replace-with-32-byte-random-secret
```

不要把真实密钥提交到 Git。

### 3. 初始化数据库

```bash
pnpm --filter @aiya/database generate
pnpm --filter @aiya/database migrate
```

### 4. 启动 Web

```bash
pnpm dev
```

打开：

- V2 创作课堂：<http://localhost:3333/create-theatre>
- V2 极简版：<http://localhost:3333/create-theatre-v2>
- 管理后台：<http://localhost:3333/admin/create-theatre>

### 5. 可选：启动生成 Runner

```bash
cp apps/create-runner/.env.example apps/create-runner/.env
pnpm create-runner
```

`create-runner` 会执行外部模型或编程 CLI。请只在**隔离的低权限账户、容器或虚拟机**中运行，并限制网络、文件系统和并发资源。不要把它直接暴露到公网。

## 构建 Android V3

```bash
pnpm --filter @aiya/android-v3 build
```

输出：`apps/android-v3/app/build/outputs/apk/debug/app-debug.apk`

V3 使用原生 Jetpack Compose，主路径为：**创作 → 试玩 → 带走**。相机、麦克风、动作传感器等能力只应在用户主动使用对应功能时申请权限。

## 常用检查

```bash
pnpm lint
pnpm typecheck
pnpm test:create-theatre-core
pnpm test:create-runner
pnpm test:apk-builder
```

## 安全边界

- 生成的 HTML 与 APK 均属于不可信内容，部署时应使用沙箱、CSP、超时和资源配额。
- 管理后台在生产环境必须配置独立 Token、模型操作密码与设置加密密钥。
- 模型 Key 只保存在服务端，不得发送到浏览器或写入生成作品。
- 不提交 APK、签名文件、数据库备份、日志或真实用户数据。
- 详细说明见 [SECURITY.md](SECURITY.md) 与 [安全架构](docs/security-architecture.md)。

## 参与贡献

欢迎提交 Issue、文档改进、教学案例、无障碍优化和 Pull Request。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 作者

- 作者：**君维**
- 联系微信：**16675143990**

## 许可证

项目代码以 [Apache License 2.0](LICENSE) 开源。仓库中的第三方模型、依赖和素材可能适用各自许可证或使用条款，详见 [NOTICE](NOTICE) 与素材目录内的来源说明。
