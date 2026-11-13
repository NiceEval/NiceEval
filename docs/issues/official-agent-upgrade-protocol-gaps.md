# Bub 与 DSH 最新版仍需验证 Adapter 协议兼容

## 观察与范围

2026-11-12 升级官方 Agent 时，npm/PyPI 的最新版本包含 Bub 0.6.1 与 DSH 0.2.2-rc.1。当前 Adapter 分别锁定 Bub 0.5.1 和 DSH 0.1.7-rc.2。本轮保留这两个版本，其余已验证 CLI 参数的默认版本更新。

## 已取得的兼容证据

Bub 0.6.1 的纯 `bub` requirement 不包含 CLI app 依赖；需要 `bub[app]`，且 uv override 也须保留 extras。其客户端从 any-llm-sdk/OpenAI 切换到 Republic，`openai` provider 默认使用 Responses，现有 Adapter 的 OpenAI-compatible Chat 配置不能原样沿用。OTel 插件 pin 的类型导入仍成功，但尚未验证新 tape 写出、OTel span 与真实 Adapter 读回组成的完整链路。因此仅更新版本号无法保证现有事件与计费证据。

DSH 0.2.2-rc.1 在宿主 Node 24.21.0 的 headless 入口出现原生 loader Unsupported/no-getter；同一包在 Docker node:24-slim 的 headless help 成功。新 headless 配方读取 DSH_PERMISSION_MODE，旧 Adapter 写入的 settings.yaml 权限预设与新 profile 的导入位置不同；尚未用公开 Adapter 入口证明模型配置和权限预设生效。

没有付费模型或云 Sandbox 调用；证据来自隔离的临时安装、原生 help、公开包源与本地 Docker。没有推断其它 Agent 不兼容。

## 期望与后续验收

维护者应适配两个 Adapter，并以本地 loopback 模型服务验证请求协议、权限、事件、usage 与 tape/OTel 读回后再升级默认版本。固定依赖闭包及所有官方配方应同批更新。本条为本地 draft，未执行远端 mutation。

## 来源与搜重

NiceEval main 上 ne-upstream-dx4 版本核对，Linux、Node 24.21.0、pnpm 11。已完整读取 GitHub open/closed Issues 的本地枚举；未发现这两个新版本的相同兼容观察。建议标签 bug、area:adapter、area:dependency、needs-triage。内容已脱敏，无凭据或私有模型输出。
