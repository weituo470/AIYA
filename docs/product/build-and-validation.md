# 生成、验证与回归

## 构建流程

AIYA 继续以单文件 HTML 为主要产物：需求与设备环境 → 有限模型路由 → 结构化安全检查 → 隔离浏览器验证 → 必要时一次证据驱动修复 → 交付。修改任务带上原作品及版本信息，不创建无界重试循环。

Web 可以选择速度、质量和智能策略，也可以通过受口令保护的模型入口选择具体配置。Android 直接显示模型名称。后台任务记录保存实际调用与验证证据，不以配置名称代替实际返回模型。

## 启动验证器

1. 将根目录 `.env.example` 复制为 Web 的本地环境配置，并填写服务端模型 Key。
2. 为 Web 与验证器设置同一个私有随机 `AIYA_BUILD_VALIDATOR_TOKEN`，至少 24 字符；不要提交真实值。
3. 安装浏览器：`pnpm --filter @aiya/create-runner exec playwright install chromium`。
4. 在具有上述环境变量的终端运行 `pnpm --filter @aiya/create-runner validate:serve`。
5. 启动 Web：`pnpm dev`。

验证器默认只监听 `127.0.0.1:3346`。不要将它直接暴露到公网。Linux 使用专用非 root 账户，并配置容器或系统级资源限制。浏览器沙箱和静态扫描不构成完整恶意代码安全证明。

`AIYA_BUILD_VALIDATION=required` 时验证器不可用会明确失败，不消耗额外模型调用来掩盖基础设施错误。显式设置为 `off` 进入兼容模式时，不能把产物标为经过浏览器验证。

## 覆盖边界

- 计算器：核心算术、交互和部分修改回归；不是所有表达式和精度情况的穷举证明。
- 任务看板：添加、完成、删除和统计等可定位交互。
- 其他作品：初始化、运行异常、可见内容、溢出及资源请求等冒烟检查。
- 摄像头、语音、体感、游戏规则及真实 Android WebView 仍需要人工或真机测试。

任务轨迹会区分通过、失败、未执行和覆盖不足。请按具体证据验收，而不是仅看“生成成功”。

## 不调用付费模型的回归

```bash
pnpm test:create-theatre-core
pnpm --filter @aiya/web test:build-phase1
pnpm --filter @aiya/web test:fusion-transport
pnpm --filter @aiya/web test:build-phase2
pnpm --filter @aiya/android-v3 test
```

Web 流程测试模拟模型供应方和任务数据库，浏览器验证运行真实 Chromium。需要先安装 Chromium。Android JVM 测试中的真实模型集成用例默认跳过；它们不证明真机运行正常。`GeneratedHtmlSafetyDeviceTest` 是针对已有作品的只读设备验收，应在明确授权的测试手机上选择性执行。

## Fusion 实验配置

Fusion 使用独立的 `AIYA_FUSION_BASE_URL` 和 `AIYA_FUSION_API_KEY`，不继承其他供应方密钥。当前包含 SSE 接收、输出预算、有限重试和进度记录。传输回归通过不代表供应方生成延迟改善，初次生成成功也不代表连续修改稳定。请使用自己的账号进行少量实测，记录首字延迟、总耗时、输出与推理 Token 和完成原因。

## Android 连续闪退回归

0.6.70 仅豁免 SVG 标签上的标准命名空间标识，不放开实际外部资源请求。内容被拒绝时，在创建 WebView 之前显示原生错误界面；保存作品不会因为拦截而被删除。

此修复有独立 JVM 用例、静态界面契约检查和可选真机测试。不应以本地构建通过替代真实设备验收。
