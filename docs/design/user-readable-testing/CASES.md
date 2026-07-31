# 共同 Cases

**相关文档**：[README](README.md) · [GOALS](GOALS.md) · [LIMITS](LIMITS.md) · [PLAN-1](PLAN-1/README.md) · [PLAN-2](PLAN-2/README.md) · [PLAN-3](PLAN-3/README.md) · [DECISION](DECISION.md)

下面八个 Case 固定候选必须处理的问题。
“用户”指 niceeval 的使用者；“读者”指评审或维护测试的人。

| Case ID | 用户问题 | 固定输入 | 验收结果 |
|---|---|---|---|
| C1 | 修改一条 eval 后，再次运行是否只重跑受影响项 | 项目先运行 `kept` 与 `rerun`，用户随后只修改 `rerun` 的 eval 源码 | 主证明一屏展示源码修改、`kept` 的公开携带来源和 `rerun` 的新执行；相邻机制证明让额外 Agent 调用立即失败，不把 fingerprint 暴露成用户输入 |
| C2 | Report 呈现变化是否仍保留用户能完成的任务 | 同一份证据同时生成 plain stdout、PTY、JSON、HTML 和浏览器页 | 每面只锁自己的语义；text / web 同源由一个关系证明直接比较两面；配色、padding 或 JSON 缩进不误伤其它行为 |
| C3 | 筛选或展开失败时能否知道错的是哪个对象 | 比较表有 `main` 与 `rag`，两个 attempt 都可展开 | 筛选后明确留下 `main`；弹窗明确属于刚点击的 attempt，不能只断言行数或 modal 存在 |
| C4 | 并发与超时规则能否确定性证明 | 两个受 barrier 控制的任务、一个可推进的测试时钟 | 机制证明展示事件顺序与时间推进，不 sleep；用户行为主证明不暴露调度实现细节 |
| C5 | 一次真实运行能否支持多面验收并单独重跑 | prepare 产出一个命名 evidence world | world 原子发布并由权限、路径守卫和前后 digest 强制只读；单个失败只在身份完全匹配时复用，不再次调用模型 |
| C6 | 外部 SDK 协议变化会不会被伪 fixture 掩盖 | 当前 SDK 与真实 provider 的同一次调用，同时捕获上游公开 usage event 和 niceeval 公开出口 | 确定性转换可以 unit 回归；兼容性主证明逐字段比较同次上下游观察或稳定协议不变量，不签入易漂的固定 token 数，也不从候选包导入预期 |
| C7 | 发布包在真实用户项目里能否工作 | 候选 tarball、仓库外 cwd、只使用公开 import 与 CLI | 安装、运行、读回和错误反馈从用户入口完成；测试不读取私有 `.niceeval` 实现细节 |
| C8 | 一个回归修复能否留下准确而不过量的证明 | 一个有公开行为后果的 bug 和一个只影响内部机制的 bug | 前者绑定稳定 Behavior ID 与主证明；后者可只加机制证明，不被迫发明用户故事 |

## 候选覆盖入口

| 候选 | 覆盖说明 |
|---|---|
| PLAN-1 | [场景元数据与媒介 matcher](PLAN-1/use-case/README.md) |
| PLAN-2 | [用户任务规格与类型化可观察读面](PLAN-2/use-case/README.md) |
| PLAN-3 | [声明式 Acceptance Case](PLAN-3/use-case/README.md) |
