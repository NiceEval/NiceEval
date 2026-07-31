# 多容器环境

Terminal-Bench 一类基准把被测环境定义成一组容器加一张网:
agent 的容器之外还有 `api`、`db` 这样的伴随服务,任务要求
agent 对着服务工作,判分时服务必须还活着。环境 profile 只能
翻译成单个预制产物时,这类任务表达不出来,下游被迫在
niceeval 之外自己编排服务、自己推导镜像。

这个决策主题回答:niceeval 用什么形态支持多容器环境。
候选项之间的分歧值得摊开比较——拓扑声明是 niceeval 自己的
typed 表、直接引用任务自带的 compose 文件、根本不接管
服务,还是让公共 Sandbox 只约束主执行空间并由各 provider
交付完整 sandbox case。四条路的迁移成本、契约可控性与
provider 覆盖面差异都很大。

## 动机:环境不对等产出假结论

真实的 TB 移植跑分里,三类失败与 agent 的表现无关,却都被
记成 `failed`、进了通过率分母:

- **服务缺席。** 任务需要 `api` / `db` 伴随服务,单容器环境
  里 agent 一开始就 `Failed to resolve 'api'`,或判分请求
  ConnectionError。
- **环境翻译有洞。** 环境定义活在 niceeval 之外,下游从
  compose 文件自己推导镜像与服务;漏读一个字段,整题在
  错误的环境里跑完十分钟,拿到一个假 `failed`。消灭手段
  是不翻译:支持 Compose 的 provider 原生消费它
  (见 [DECISION](DECISION.md)),compose 保持单一事实源。
- **会话残留进程死亡。** agent 前台启动的 server 随 exec
  会话销毁,判分时服务不在。此条与拓扑无关,契约已单独成篇:
  [Roadmap · Agent 进程契约](../../roadmap/agent-process-contract/README.md),
  三个候选方案都以它为前提。

假 `failed` 比缺功能更贵:它进分母掺水,还按
[缓存沿用门表](../../feature/experiments/cache.md)被当成
可携带终态永久固化。

**相关文档**:
[GOALS](GOALS.md) ·
[LIMITS](LIMITS.md) ·
[PLAN-1](PLAN-1/README.md) ·
[PLAN-2](PLAN-2/README.md) ·
[PLAN-3](PLAN-3/README.md) ·
[PLAN-4](PLAN-4/README.md) ·
[真题落地样例](PLAN-4/use-case/README.md) ·
[DECISION](DECISION.md)
