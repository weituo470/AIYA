# AIYA APK 化与作品导出 APK 规划

> 目标：把 AIYA 主网页应用做成可安装 Android APK，并让 `create-theatre-v2` 里学生生成的单文件 HTML 作品也可以导出为 APK。
>
> 当前结论：两条线并行推进，但技术路线不同。

## 1. 范围拆分

### A. AIYA 主应用 APK

推荐路线：**Capacitor Android 壳**。

原因：

- AIYA 主应用是在线服务，需要登录、语音、下载、TTS、可能的推送和原生权限。
- Capacitor 保留 Web 技术栈，同时允许后续接 Android 原生能力。
- 比纯 TWA 更可控；TWA 更适合已经完整 PWA 化、且能配置 Digital Asset Links 的站点壳。

首版形态：

- APK 打开后加载 `https://aiya.shenliu.cc` 或专用移动入口。
- 权限：麦克风、文件下载/分享按需申请。
- 保留线上 Next.js 服务作为真实运行时，不把整个 Next.js server 塞进 APK。

### B. 学生作品导出 APK

推荐路线：**后端 APK 构建服务 + Android WebView 模板**。

原因：

- 学生作品目前是 AIYA 生成的单文件 HTML/CSS/JS，适合嵌入 APK assets。
- 每个作品可以生成独立包名、应用名、图标、版本号。
- 初版无需联网权限，降低安全风险，也避免学生作品偷偷访问网络。

首版形态：

- 用户点击「下载 APK」。
- 前端把当前作品 HTML、作品名、图标/主题色等发送到构建接口。
- 后端创建一次性 Android WebView 项目，把 HTML 写入 `app/src/main/assets/index.html`。
- Gradle 产出 debug/signed APK，返回下载链接。

## 2. 分阶段执行计划

### Phase 0：本地技术钉子（当前 GOAL 首个里程碑）

- 新增 `apps/apk-builder` 原型。
- 输入一个单文件 HTML。
- 输出一个 Android debug APK。
- 默认无 `INTERNET` 权限。
- 先用本机 Android SDK/JDK 验证构建链可用。

验收：

- `pnpm --filter @aiya/apk-builder build` 通过。
- `pnpm --filter @aiya/apk-builder smoke` 能产出 `.apk`。

### Phase 1：AIYA 主应用 APK 壳

- 新建 `apps/android-shell` 或升级现有 `apps/mobile`。
- Capacitor 配置 Android 平台。
- 加载线上 AIYA 移动入口。
- 验证：
  - 登录
  - create-theatre-v2
  - 麦克风权限
  - TTS 播放
  - 下载 HTML / 分享

### Phase 2：作品导出 APK MVP

- 把 `apps/apk-builder` 接到服务端。
- 新增 API：
  - `POST /api/create-theatre/apk-jobs`
  - `GET /api/create-theatre/apk-jobs/:id`
  - `GET /api/create-theatre/apk-jobs/:id/download`
- 前端新增按钮：「下载 APK」。
- 构建任务进入队列，避免阻塞 Next.js 请求线程。
- 临时文件写入 `.state/apk-jobs` 或对象存储。

### Phase 3：产品化增强

- 用户自定义：
  - 应用名
  - 图标
  - 包名后缀
  - 横屏/竖屏
  - 启动画面
  - 版本号
- 产物管理：
  - APK 历史记录
  - 过期清理
  - 下载次数
  - 重新构建
- 签名：
  - 平台统一 debug 签名用于试玩
  - 可选用户专属 release keystore
  - 若上架应用商店，需要正式签名和合规流程

## 3. 安全边界

学生作品 APK 必须默认采用收紧策略：

- 不声明 `android.permission.INTERNET`。
- 拒绝 HTML 中的外部资源、`fetch`、`XMLHttpRequest`、`WebSocket`。
- 拒绝 `localStorage`、`sessionStorage`、`IndexedDB`、`document.cookie`。
- APK 构建在隔离工作目录中执行，构建完成后定期清理。
- 包名、应用名、图标必须经过服务端校验。

## 4. 建议仓库结构

```text
apps/
  android-shell/             # AIYA 主应用 Capacitor APK 壳，Phase 1
  apk-builder/               # 学生作品 HTML -> APK 构建器，Phase 0/2
apps/web/src/app/api/create-theatre/apk-jobs/
  route.ts                   # 创建 APK 构建任务
  [jobId]/route.ts            # 查询任务状态
  [jobId]/download/route.ts   # 下载 APK
```

## 5. 当前技术基线

本机已确认：

- JDK：21
- Android SDK：`%LOCALAPPDATA%\Android\Sdk`
- SDK Platform：`android-36`
- Android Gradle Plugin 缓存：`8.13.0`
- Gradle Wrapper 缓存：`8.14.3`

## 6. 关键决策

- 主 AIYA APK：先不要做离线包，保持在线 Web + 原生壳。
- 学生作品 APK：先做离线 WebView APK，后续再加图标、签名、队列、下载链接。
- 线上部署前，先在本地用一个 sample HTML 产出 APK，证明构建链闭环。
