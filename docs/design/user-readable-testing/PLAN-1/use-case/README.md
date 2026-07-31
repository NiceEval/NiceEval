# 方案 1：Use Cases

**相关文档**：[方案](../README.md) · [Architecture](../architecture.md) · [Lifecycle](../lifecycle.md) · [共同 Cases](../../CASES.md)

本页按共同 Cases 说明场景元数据与媒介 matcher 怎样工作。

## C1：缓存复用

测试继续留在 Runner 当前目录。
`behavior()` 把标题、契约与主证明连起来；fixture 与断言显式写出 `kept` 和 `rerun` 两个 attempt 身份。

读者能从单例看出谁被复用、谁被重跑，但仍要靠 Registry 才能按用户任务找到分散的测试。
本方案部分满足 C1。

## C2：Report 多读面

同一份 evidence 分别交给 plain stdout、PTY、JSON、HTML 与 browser matcher。
框线、CSS class、DOM 包装、JSON 缩进或 XML 空白不会让其它媒介测试失败。

如果变化触及该媒介公开承诺，对应 matcher 仍会失败。
本方案完整区分 C2 的观察面。

## C3：筛选与展开

筛选 matcher 接收预期行身份 `main`，而不是只接收 `1`。
Attempt dialog matcher 同时接收点击的 attempt ID 和预期内容。

Matcher 可以提高断言门槛，却不能理解任意自然语言标题。
本方案只能部分机械保证 C3。

## C4：并发与超时

Runner 机制测试继续使用 barrier、受控 clock、Layer 和带身份的事件序列。
Proof 元数据只生成带稳定 ID 的标题，再交给原生 `it.effect` / `it.scoped`，不把这些控制隐藏进用户 DSL。

用户行为主证明只观察 attempt 的重用、执行与结果。
本方案完整保留 C4 的确定性。

## C5：命名 Evidence World

真实运行先生成并冻结命名 world。
text、JSON、JUnit 与 browser matcher 随后只读同一份证据，并可用 Vitest 单独重跑。

本方案定义新场景的规则，却不会自动消除旧 orchestrator 的可变共享状态。
迁移完成前只部分满足 C5。

## C6：外部协议

确定性协议转换 fixture 可以挂成 supporting proof。
兼容性的 primary proof 必须留在使用当前 SDK 和真实 provider 的自治 E2E。

Matcher 不从候选包导入 schema 或预期。
本方案完整满足 C6。

## C7：包外消费者

package consumer 在仓库外 cwd 安装候选 tarball，只调用公开 import 与 CLI。
Behavior 元数据改善追踪，断言仍必须来自公开 stdout、机器出口、HTML 或浏览器。

测试不能读取 `src/` 或私有记录实现补足证据。
本方案沿用真实边界，完整满足 C7。

## C8：回归证明

有公开行为后果的 bug 在 Behavior 元数据中记录 bug 引用，并补主证明或 supporting proof。
只影响内部机制的 bug 可以只增加普通机制测试。

Registry 展示 `bug → Behavior → primary proof`。
它能证明追踪完整，却不能代替 fixture 与断言质量评审。

## 采用判断

这个方案适合先修复脆弱断言、粗粒度 Registry 与失败诊断。
如果读者仍无法按用户任务连续阅读，或同一任务开始在多个媒介重复编排，应停止扩张 matcher，转向 [PLAN-2](../../PLAN-2/README.md)。
