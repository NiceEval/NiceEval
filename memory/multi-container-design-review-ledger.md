# 多容器环境设计:正反评审台账(2026-07-30)

**背景**:`docs/design/multi-container-environments/` 定稿前,两个子代理分别做红队攻击(对照十篇既有契约)与下游落地验证(三个真实 Terminal-Bench 任务逐题写代码)。结论并入 PLAN-1 与 DECISION;本条目存评审揭出的翻案与反直觉点,供复盘。

**红队确认的 fatal 类(全部采纳修法)**:

- 新增「前置阶段」时,attempt deadline / `executionMs` / 并发位三个口径都要显式安置——环境物化最初落在三者之外,首轮 10 分钟镜像构建期间 deadline 根本没在跑。修法:物化排在取并发位之后,计时起点前移。
- 新资源种类(服务容器、docker 网络)默认游离在 provisioning kill-on-failure、provision token、孤儿核对、`prune` 词表、中断矩阵之外,每处都要逐一加行;网络这种「非实例资源」最容易被漏。
- 「服务逐个启动」按声明顺序读会让提案自己的示例必死(api 先于 db 起,ready 超时 errored 且永不携带);且与「指纹不含声明顺序」互相矛盾。修法:并行启动 + `dependsOn` 显式依赖,行为与顺序无关后指纹声明才成立。
- 手抄拓扑表复活了立项要消灭的「翻译有洞」bug 类。修法:compose 导入器为存量主路径,未认识 key 一律报错;规范化拓扑仍是唯一契约实体。

**反直觉点(值得复盘)**:

- 云 provider「VM 内 docker + agent 直跑 VM」会让 agent 与 daemon 同权:`docker exec` 直写 db 绕过被测 api,产出跨 provider 系统性分叉的假 passed——比假 failed 更难发现。修法:agent 也进容器与服务同网。
- 「进程寿命 = 沙箱寿命」与「超时要停得下失控 agent」「E2B pause 冻结内存、resume 后 CLI 复活烧配额」冲突;契约收窄为正常结束路径长命,超时/中断/suspend 前 adapter 有界终止进程组。
- 全 `skipped` 的 run 退出 0 是 CI 假绿;config 表键名笔误会静默退化成单容器假 failed。修法:全量跳过升启动期报错,unused config key 穷举报错。
- 服务 env 里的 secret 会经指纹触发全量重跑、经拓扑投影明文落盘;`{ fromEnv }` 间接形态让变量名进指纹、值两边都不进。

**过程判断**:正反双向(落地验证 + 红队)比单向评审有效——正方发现的是「契约没说清、只能猜」(depends_on、ready 参数、agent env 槽位),红队发现的是「与既有契约打架」(口径、回收、留存);两类几乎不重叠。红队报告同时列出 9 条「攻不动的点」,为核心切分(Sandbox 接口不动、服务不进归因、能力位中性)提供了正面证据。
