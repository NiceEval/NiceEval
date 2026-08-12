# 执行失败分类 —— 用例

本目录是失败分类(时间轴重试与空间轴止损)的用例文档(体裁约定见[功能文档](../../README.md)):一篇讲一种使用姿态的全流程——用户遇到什么问题、从现象到结束反馈的完整路径、边界与何时改用别的模式。
契约单源在 [README](../README.md)、[Architecture](../architecture.md) 与 [Library](../library.md),这里只做叙事串联,不复制契约定义。

三篇对应三种姿态,从症状进来先查表:

| 你看到的现象 | 读哪篇 |
| --- | --- |
| `errored` Verdict 的 message 带 `retries exhausted` 后缀,或 activity 里见过 `turn retry` | [读懂 errored](reading-errored.md)(重试耗尽分支) |
| `errored` Verdict 对应流中断 / 连接重置,message **没有**重试摘要后缀 | [读懂 errored](reading-errored.md)(不可重试分支) |
| 几十条 attempt 报同一个死因,各自白烧一个沙箱——起跑(setup / 探测 / fixture 校验)就死 | [抛出点声明死因](declare-fatal-scope.md) |
| 同上,但死在 run 中途,以对某个 host 的连接错误浮出 | [写分类器](write-a-classifier.md)(实验侧) |
| 自家 agent 的限流文案被判了不可重试 | [写分类器](write-a-classifier.md)(adapter 侧) |

- [读懂一次 errored:框架重试过没有,为什么](reading-errored.md) —— 零配置的内建观察面:现象 → 机制读法 → 恢复路径。
- [抛出点声明死因:一次命中,按波及范围止损](declare-fatal-scope.md) —— 作者声明自己拥有的知识:选档 → 写声明 → 你会看到 → 恢复。
- [写分类器认第三方错误:取证、裁决、声明、验证](write-a-classifier.md) —— 教框架认制造者用不了 fatal 错误类的错误,实验侧与 adapter 侧同一条纪律。

API → 篇目对照:

| API | 篇目 |
| --- | --- |
| (无配置面,内建行为的观察面) | [reading-errored](reading-errored.md) |
| `ExperimentFatalError` / `EvalFatalError` | [declare-fatal-scope](declare-fatal-scope.md) |
| `ExperimentDefinition.classifyFailure` | [write-a-classifier](write-a-classifier.md) |
| `Agent.classifySendFailure` / `sendFailureText` | [write-a-classifier](write-a-classifier.md) |
