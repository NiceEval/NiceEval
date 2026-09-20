---
format: niceeval.docs-node/v1
kind: feature
relations: {}
---

# 错误助手

错误助手让用户在失败现场看到原因、归属、源码位置和可行动的下一步。DX 迁移是其中需要附完整迁移指南的一种错误。
所有人读终端文案为英语；浏览器沿用自己的中英 catalog。它不调用模型解释异常，也不要求网络才能读到说明。

领域 owner 继续判断错误原因、重试安全性与影响范围。错误助手只把既有失败转换为安全、可读的反馈，
不改 Verdict、退出状态、取消、Attempt 封口或资源释放，不把一次局部失败升级为整个 Run 的停止指令。

## 基本错误与补充信息

基本错误包含稳定 code、安全摘要和已有归属，在增强失败时仍可交付。
已知错误由所属 owner 提供建议；未知异常保留原始 cause 在进程内的关联，公开输出只采用有界安全摘要。
源码定位、source map resolution 和长说明按需加载，并受整次命令或 Invocation 的预算约束。

成功路径不为错误助手扫描源码、读取 Markdown、捕获额外 stack 或启动后台工作。
出现大量错误时，增强可以降级；基本错误、取消与 cleanup 不等待定位队列。
性能契约和验收切片见 [Architecture](architecture.md#性能预算)。

人读交付层可以将同一命令或 Invocation 内的同类失败合并展示。
已知错误只在 code、owner、repair target 和 guide ID 全部相同时聚合；未知错误保持单例。
聚合不修改原有失败事实、影响对象、源码位置或它们的 owner，只减少人读重复输出。

## DX 迁移

从 `0.15.0` 起，每项破坏作者体验的 API、配置或 CLI 变化都绑定稳定 migration ID、被替换写法、检测入口和英文指南。
当前运行时只执行当前契约；识别到旧写法就拒绝相关动作。保留的旧入口只能报迁移错误，不能运行旧语义或静默转换参数。

英文 Markdown 的源码 owner 为 `packages/niceeval/src/migrations/<id>.md`，随发布包复制到 `dist/migrations/`。
错误现场显示实际代码位置和整篇指南；同一指南命中多处时正文只输出一次，并列出各命中位置。
迁移说明属于发布资产，不依赖仓库 `docs/` 或在线网站存在。

检测只识别具名旧写法，不能识别任意动态 TypeScript。普通参数验证识别旧结构；拒绝型旧入口直接返回 migration 错误；
模块加载已失败时才依据可靠导入绑定做有限源码识别。有效项目不承担另一遍迁移源码扫描。

配置阶段命中时不创建 Invocation、不运行 setup 或发 Provider 请求。执行中才遇到的旧调用立即拒绝该调用，
此前已发生的动作仍由原生命周期收尾。用户模块顶层求值不在“相关动作不执行”的保证内。
源码 API 迁移与历史 Record 读取分别治理；移除旧执行路径不授权重写或删除历史事实。

| 入口 | 内容 |
| --- | --- |
| [Library](library.md) | 领域错误、公开迁移错误与源码位置 |
| [CLI](cli.md) | 终端和机器反馈、迁移指南显示 |
| [Architecture](architecture.md) | 失败边界、惰性增强、性能预算与发布义务 |
| [Judge](../judge/library.md#旧配置的迁移诊断) | 从普通 Judge 配置对象改为具名 Provider 的迁移 |
| [执行失败分类](../error-classification/README.md) | 重试与停止派发的唯一决策 owner |
