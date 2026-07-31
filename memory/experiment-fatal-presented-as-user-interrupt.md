# ExperimentFatalError 被呈现成用户中断

**现象**:多实验并跑时,一条泳道的 setup 抛 `ExperimentFatalError`,错误正文被吞,终端只剩一行 `interrupted` + 退出码 130,与用户 Ctrl+C 完全无法区分;且无关实验的进度一并被拖垮(2026-07-31 MemoryBench 真机)。排障时曾被误诊为「用户手滑关了终端」,浪费了一整轮。

**根因**:实现差距,不是契约缺口——`docs/feature/error-classification/README.md` 已声明:experiment 闸只停**本实验**的派发;fatal 的 `message` 走运行期反馈流 + `run.json` 实验域诊断(`dispatch-halted`)双通路;退出码按 verdict 折叠应为 1(errored),130 只属于真实中断。实测三条都不满足。

**修法**:已修(2026-07-31)。根因是两处叠加,一处造缺陷、一处把缺陷伪装成中断:

1. `src/runner/run.ts` 的复用池租借(`sandboxReuse: true` 时 `SandboxSpec` setup 钩子跑在池的实例创建里)直接 `Effect.promise(() => pool.acquire(...))`,拒绝穿过 Effect 边界变成 defect,打断 `forEach` 连坐同批其它实验——违反「attempt fiber 的 `E` 恒为 never」。改成把拒绝接回本地:先经 `attemptFailureDeclaration()`(新导出自 `src/runner/attempt.ts`,与 attempt 内的 `declareFailure` 共用同一条空间轴决议链)落止损闸,再折成 `errored`(phase `sandbox.create`)走与 `blockedError` 相同的下游路径。
2. 同文件收束处用 `Cause.isInterrupted` 判中断:一条 fiber 的 defect 会连带中断兄弟 fiber,合成 cause 同时含 die 与 interrupt,该谓词对它为真——于是正文被咽掉、状态落 `interrupted`、退出码 130。改用 `Cause.isInterruptedOnly`,混着 die 的 cause 归真·缺陷照常上抛。

回归测试:`src/runner/run.test.ts`「复用池租借失败」(覆盖类别见 `docs/engineering/testing/unit/experiments-runner.md`「派发前资源获取失败的归一化」)。
