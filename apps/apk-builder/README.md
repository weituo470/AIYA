# @aiya/apk-builder

AIYA 学生作品 APK 构建器原型。

当前用途：把 `create-theatre-v2` 生成的单文件 HTML/CSS/JS 包进一个最小 Android WebView APK。

## 本地验证

```powershell
cd AIYA
pnpm --filter @aiya/apk-builder build
pnpm --filter @aiya/apk-builder smoke
```

成功后会生成：

```text
apps\apk-builder\dist\aiya-counter-game-debug.apk
```

## CLI

```powershell
node apps\apk-builder\src\build-generated-apk.mjs `
  --html path\to\work.html `
  --title "我的作品" `
  --package cc.shenliu.aiya.generated.mywork `
  --out apps\apk-builder\dist\mywork-debug.apk
```

## 安全默认值

- 不声明 `INTERNET` 权限。
- 拦截 `http://` 和 `https://` 导航。
- HTML 校验会拒绝外部资源、网络 API 和浏览器持久化 API。
- 当前是 debug APK 原型，不用于正式上架签名。
