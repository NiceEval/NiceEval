# ExperimentFatalError 被呈现成用户中断

**现象**:多实验并跑时,一条泳道的 setup 抛 `ExperimentFatalError`,错误正文被吞,终端只剩一行 `interrupted` + 退出码 130,与用户 Ctrl+C 完全无法区分;且无关实验的进度一并被拖垮(2026-07-31 MemoryBench 真机)。排障时曾被误诊为「用户手滑关了终端」,浪费了一整轮。

**根因**:实现差距,不是契约缺口——`docs/feature/error-classification/README.md` 已声明:experiment 闸只停**本实验**的派发;fatal 的 `message` 走运行期反馈流 + `run.json` 实验域诊断(`dispatch-halted`)双通路;退出码按 verdict 折叠应为 1(errored),130 只属于真实中断。实测三条都不满足。

**修法**:未修。按既有契约修:fatal 正文进反馈流与 `run.json`,该实验的 attempt 记 `errored(experiment-setup-failed)`,其余实验照跑,退出码不走 130。
