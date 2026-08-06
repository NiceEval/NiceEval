# Adapter 准入目标

NiceEval 只为拥有稳定程序化驱动面和结构化事件契约的上游提供官方 Adapter。
Adapter 必须通过受支持的 CLI、SDK 或 API 驱动，不使用 GUI 自动化或私有逆向接口。
已经满足准入条件的对象在[`../../feature/adapters/sdk/`](../../feature/adapters/sdk/README.md)定义完整契约。

## 目标接入

| 对象 | 准入契约 |
|---|---|
| Cursor Agent SDK | 稳定 API 覆盖 session、HITL 与 usage；真实示例证明这些能力；转换器不强制消费方安装完整 SDK 包 |
| vm0 | 官方接口提供稳定结构化事件与会话恢复契约 |

## 排除边界

Alma 只有 GUI 或非公开驱动面，因此不属于官方 Adapter 目标。
任何上游都必须先满足同一套受支持接口条件，不能用专属自动化旁路降低准入标准。
