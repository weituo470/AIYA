# AIYA V3 Android

AIYA V3 是面向手机端的原生 AI 编程启蒙应用，采用 Kotlin、Jetpack Compose 与 Material 3。

## 交互主路径

- **创作**：文字输入或按住说话，描述想做的应用。
- **试玩**：生成过程中展示进度，完成后用受控 WebView 运行单文件 HTML。
- **带走**：查看/复制源码、下载 HTML、构建作品 APK、浏览优秀作品。

应用不要求用户登录、建档或录入声纹。相机、麦克风和动作传感器等敏感权限只在用户主动使用相应功能时申请。

## 构建

需要 JDK 17、Android SDK 36，并配置 `ANDROID_HOME` 或 `ANDROID_SDK_ROOT`：

```bash
pnpm --filter @aiya/android-v3 build
```

输出：

```text
apps/android-v3/app/build/outputs/apk/debug/app-debug.apk
```

## 关键实现

- `MainActivity.kt`：Compose UI、项目/版本管理、生成、WebView、导出与更新。
- `AiyaBodyVisionEngine.kt`：前置摄像头、Face Landmarker 与 Gesture Recognizer 桥接。
- `assets/aiya_body/`：官方 MediaPipe task 模型，来源与哈希见仓库根目录 `NOTICE`。
- `androidTest/`：体感能力的设备端测试资产与测试代码。

## 真机检查

请按 [DEVICE-QA.md](DEVICE-QA.md) 完成权限、生成、试玩、导出、后台切换和更新流程。生成内容及 APK 均应视为不可信输入，不要在高权限设备或包含敏感资料的测试环境中运行未知作品。
