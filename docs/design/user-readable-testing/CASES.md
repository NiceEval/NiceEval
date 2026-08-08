# 共同 Cases

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [PLAN-4](PLAN-4/README.md) · [DECISION](DECISION.md)

下面九个 Case 固定候选必须处理的问题。
“用户”指 niceeval 的使用者；“读者”指评审或维护测试的人。

| Case ID | 用户问题 | 固定输入 | 验收结果 |
|---|---|---|---|
| C1 | 修改一条 eval 后，再次运行是否只重跑受影响项 | 项目先运行 `kept` 与 `rerun`，用户随后只修改 `rerun` 的 eval 源码 | 单边界 E2E 一屏展示源码修改、`kept` 的公开携带出处和 `rerun` 的新执行；相邻 Unit 让额外 Agent 调用立即失败，不把 fingerprint 暴露成用户输入 |
| C2 | Report 呈现变化是否仍保留用户能完成的任务 | 同一份证据同时生成 plain stdout、PTY、JSON、HTML 和浏览器页 | 每面只锁自己的语义；text / web 同源由一个关系测试直接比较两面；配色、padding 或 JSON 缩进不误伤其它结果 |
| C3 | 筛选或展开失败时能否知道错的是哪个对象 | 比较表有 `main` 与 `rag`，两个 attempt 都可展开 | 筛选后明确留下 `main`；弹窗明确属于刚点击的 attempt，不能只断言行数或 modal 存在 |
| C4 | 并发与超时规则能否确定性证明 | 两个受 barrier 控制的任务、一个可推进的测试时钟 | Unit 展示事件顺序与时间推进，不 sleep；E2E 不暴露调度实现细节 |
| C5 | 一次真实运行能否支持多面验收并单独重跑 | 一个场景 Repo 在 prepare 中产出命名证据 | 共享证据在 prepare 后只读；会修改结果的测试使用独立结果根；单文件可原生过滤重跑 |
| C6 | 外部 SDK 协议变化会不会被伪 fixture 掩盖 | 当前 SDK 与真实 provider 的同一次调用，同时捕获上游公开 usage event 和 niceeval 公开出口 | 确定性转换可以 Unit 回归；live adapter E2E 比较同次上下游观察或稳定协议不变量，不签入易漂的固定 token 数，也不从候选包导入预期 |
| C7 | 发布包在真实用户项目里能否工作 | 候选 tarball、仓库外 cwd、只使用公开 import 与 CLI | 安装、运行、读回和错误反馈从用户入口完成；测试不读取私有 `.niceeval` 实现细节 |
| C8 | 一个回归修复能否留下准确而不过量的证明 | 一个有公开行为后果的 bug 和一个只影响内部机制的 bug | 前者扩大对应 E2E owner 并做历史 kill；后者只加最小 Unit，不被迫发明用户故事 |
| C9 | 本地与 GitHub CI 能否运行同一套 E2E | 同一候选 tarball、一个无密钥 Report 项目、一个 Docker 项目和一个 live adapter 项目 | 本地与 CI 调用同一根命令；PR 不取密钥；Docker / host 不静默互换；release 测试并发布同一 tarball |

## 候选与用例入口

| 候选 | 对应用例说明 |
|---|---|
| PLAN-1 | [场景元数据与媒介 matcher](PLAN-1/use-case/README.md) |
| PLAN-2 | [用户任务规格与类型化可观察读面](PLAN-2/use-case/README.md) |
| PLAN-3 | [声明式 Acceptance Case](PLAN-3/use-case/README.md) |
| PLAN-4 | [真实场景 Repo 与原生结果断言](PLAN-4/use-case/README.md) |
