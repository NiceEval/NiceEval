# Agent 进程契约 —— 寿命与退出语义

两条候选契约,消灭「基建失败被记成任务失败」的两类假结论。
它们是[多容器环境决策](../../design/multi-container-environments/README.md)
三个候选方案共同的前提,但本身与拓扑无关、没有方案分歧,
工程量也远小于拓扑,适合先行落地。

## 进程寿命:沙箱是唯一边界

契约一句话:**沙箱内启动的进程,唯一寿命边界是沙箱本身;
exec 会话结束不附带回收会话残留的进程。**

- provider 义务:exec 不挂控制终端(或以独立会话起进程),
  消除「pty 关闭 → 前台进程组收 SIGHUP」的隐式回收链。
  这条与「`/tmp` 必须可写」并列,定稿时进
  [Sandbox 架构的 provider 义务清单](../../feature/sandbox/architecture.md#沙箱在生命周期里的位置)。
- 适用于全部执行入口:adapter 驱动 agent 的那次执行、
  `t.sandbox.runCommand` / `runShell`、各层 Hook 里的命令。

为什么必须定义:真实案例里 agent 前台启动 `node server.js`,
自测拿到 200 OK 后收工;exec 会话销毁把 server 一起带走,
判分时 ConnectionError。同一个动作在 tmux 形态的基准里活到
容器销毁——两套语义,模型不可能知道自己踩了哪套。这不是
「谁杀了进程」的 bug,是「会话该活多久」未定义。

契约向长命一侧对齐,理由有二:与主流基准的行为可比,
以及「任务完成」不该要求 agent 记得 `nohup`——起一个服务
让它活着,就是这类任务本身。

契约的边界,三条:

- 它消灭的是 provider 侧的隐式回收链。agent CLI 自己的
  工具超时杀掉了自己拉起的进程,是 agent 行为,如实计入
  表现,`failed` 是公道的。
- 长命语义只属于**正常结束路径**。attempt 超时或中断时,
  adapter 承担相反的显式义务:有界终止本次 send 拉起的
  整棵进程组——失控的 agent 必须停得下来,残留 server
  被连坐可接受,该 attempt 已是 `errored`。没有这条,
  幸存的工具子进程会穿过收尾一路写到 `workspace.diff`
  导出期间,证据失去一致性。
- 留存(suspend)前同样对 agent 进程组做有界终止:
  E2B pause 连内存一起冻结,不终止的话,用户日后
  `sandbox enter` 唤醒现场,被冻结的 agent CLI 会从断点
  复活继续消耗 API 配额。

与归因契约的相容:残留进程活着不等于继续写 workspace。
Adapter 在 send 返回时的
[静止态义务](../../feature/sandbox/architecture.md#变更归因send-窗口与分类账)
不变;残留进程落在窗口外的 workdir 写入按既有规则记进
eval 归因。eval 作者可用 `diff.ignore` 把已知的服务日志
路径请出归因清单;`workspace.diff` 导出前先在分类账落一笔
锚定 commit,导出读锚定态,不受并发写入影响。

三家 provider 的 exec 会话语义各不相同,「义务已履行」不能
靠声明,要有逐 provider 的契约探针:exec 起一个长命进程后
结束会话,数秒后新 exec 验证该进程仍存活。探针纳入 provider
义务测试与模板发布门槛
(memory 台账里 `--keep-sandbox` 三家同时假成功的先例,
就是缺这类检查的代价)。同一探针族还要覆盖命令级超时:
超时销毁流之后进程是否被杀,三家行为不一,各自的实际后果
写进对应 provider 的接入文档,不许留给用户实测发现。

## 非零退出:执行错误,不是任务失败

契约一句话:**agent 进程非零退出按执行错误计,
`verdict: "errored"`,不记 `failed`。**

判据:进程没有正常结束,意味着没有得到一个判定——限流、
CLI 崩溃、网络中断都属于此类,与超时、沙箱创建失败同类。
这与[执行失败分类](../../feature/error-classification/README.md)
「基建问题不是 agent 表现」的既有轴线一致。

记成 `failed` 的双重危害,也是这条契约的动机:

- 通过率分母掺入基建失败,分数被稀释。
- 按[缓存沿用门表](../../feature/experiments/cache.md),
  `failed` 是可携带终态、`errored` 才重跑——假结论会被
  永久固化,后续 run 连自愈的机会都没有。

边界归 adapter,核心不认退出码:

- 某 CLI 把特定非零退出码文档化为正常结束时,由该 adapter
  在协议层映射成正常完成——协议知识住在 adapter,与
  [核心中立](../../architecture.md)一致。
- 非零退出先走既有的 turn 级错误分类与有界重试链
  (限流类非零退出正是 turn 重试要吸收的头号样本,直判
  `errored` 会绕过 attempt 内自愈整层);重试耗尽或分类为
  不可重试,才落 `errored`,并保留退出码与 stderr 尾部
  (有界截断)进诊断。

落点:定稿时「非零退出」并入 adapter 契约的失败语义
([Adapter · 配置归属不变量](../../feature/adapters/architecture/agent-contract.md)
所在篇的生命周期与失败语义部分),「进程寿命」并入
Sandbox 架构的 provider 义务;本篇随之整体归档。
