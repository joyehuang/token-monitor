# English

**Open-source build, not paid-signed.** macOS and Windows will ask you to confirm on first launch — instructions below.

## What's changed

### Added
- Settings -> Collection -> Custom model pricing now lets you override a model's USD-per-1M-token rates when the detected price is wrong.
- Custom pricing can pre-fill the current detected model price and writes tokscale-compatible `custom-pricing.json` overrides for collection.

### Improved
- Multi-device Sync now shows clearer Hub stream status and offline reasons, including wrong secret, refused connection, timeout, DNS, unreachable network, and reconnecting states.

### Fixed
- Host hub mode now serves this device's own usage in-process instead of relying on a loopback HTTP connection, so local host-mode stats keep working when loopback is blocked or unavailable.

## Which file should I download?

- **macOS (Apple Silicon, M1 and later)** — the `.dmg` file
- **Windows 10/11** — `Token Monitor Setup ….exe` (installer, recommended)
- **Windows portable** — `Token Monitor ….exe` (runs without installing)

Intel Macs and Linux are not pre-built — run from source per the [README](https://github.com/Javis603/token-monitor#readme). The macOS `.zip` is the same app repackaged; ignore it unless you specifically need it.

## First-launch unlock

**macOS:** right-click `Token Monitor.app` → Open (once). If you see "Token Monitor" can't be opened or is damaged:

```bash
xattr -dr com.apple.quarantine "/Applications/Token Monitor.app"
```

**Windows:** SmartScreen → More info → Run anyway.

## tokscale dependency

Tokscale is bundled with this app. See **Settings → Tokscale** for the exact version
and the option to download a newer version directly from npm. Tokscale is MIT,
open-source: https://github.com/junhoyeo/tokscale

---

# 中文

**这是开源构建，不是付费签名版本。** macOS 和 Windows 首次启动时会要求你手动确认，操作说明见下方。

## 更新内容

### 新增
- 设置 -> 采集 -> 自定义模型单价 现在可以覆盖某个模型的 USD / 1M tokens 单价，用于修正自动检测价格不准确的情况。
- 自定义单价可自动带入当前检测到的模型价格，并写入兼容 tokscale 的 `custom-pricing.json` 覆盖配置。

### 改进
- 多设备同步现在会显示更清楚的 Hub 串流状态和离线原因，包括密钥错误、连接被拒、连接超时、DNS、网络不可达和正在重连等状态。

### 修复
- Host Hub 模式现在会在进程内提供本机用量，不再依赖回环 HTTP 连接；当 loopback 被阻止或不可用时，本机 host-mode 统计仍可正常工作。

## 应该下载哪个文件？

- **macOS（苹果芯片，M1 及之后机型）** — 下载 `.dmg` 安装包
- **Windows 10/11** — 下载 `Token Monitor Setup ….exe`（安装版，推荐）
- **Windows 便携版** — 下载 `Token Monitor ….exe`（无需安装，直接运行）

Intel Mac 和 Linux 暂不提供预构建版本，请参考 [README](https://github.com/Javis603/token-monitor#readme) 从源码运行。macOS 的 `.zip` 只是同一个 app 的重新打包版本，除非你明确需要，否则可以忽略。

## 首次启动放行

**macOS：** 右键 `Token Monitor.app` → 打开（只需要一次）。如果看到「Token Monitor」未开启 或 已损坏：

```bash
xattr -dr com.apple.quarantine "/Applications/Token Monitor.app"
```

**Windows：** SmartScreen → 更多信息 → 仍要运行。

## tokscale 依赖

Tokscale 已随应用内置。你可以在 **设置 → Tokscale** 查看确切版本，
也可以直接从 npm 下载更新版本。Tokscale 是 MIT 开源项目：
https://github.com/junhoyeo/tokscale
