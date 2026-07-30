# Adapter 路线图

这里记录仍需外部稳定性、契约未定的接入候选。
已定稿对象的契约页位于[`../../feature/adapters/sdk/`](../../feature/adapters/sdk/README.md)。

## 观察

| 对象 | 启动条件 |
|---|---|
| Cursor Agent SDK | API 稳定；真实示例覆盖 session、HITL 和 usage；转换器无需依赖整个 SDK 包 |
| vm0 | 官方提供稳定结构化事件和会话恢复契约 |

## 不接

Alma 没有稳定程序化驱动面。
niceeval 不通过 GUI 自动化或私有逆向接口制造 Adapter；未来出现受支持的 CLI、SDK 或 API 后再重新评估。
