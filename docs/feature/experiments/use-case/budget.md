# `--budget`:一批长跑实验,给烧钱装安全网

## 解决什么问题

夜间跑一批 `runs: 5` 的长任务实验,单条 attempt 就要几十分钟、几美元;agent 一旦在某类题上反复兜圈,一晚上能烧掉一个月的预算。实验文件里的 `budget` 字段是签入的常规上限;某次运行想临时收紧或放宽——比如换了更贵的模型先试探性跑一轮——用 `--budget` 覆盖它,不改签入配置。

## 全流程

1. 实验签入常规预算(`budget: 15`,见 [README · `defineExperiment` 的形状](../README.md#defineexperiment-的形状));本次回归想把每个选中配置的上限临时提到 25 美元——budget 按 experimentId 域各自计,`regression` 展开成几个配置就是几份 25,不是一次调用的总闸:

   ```sh
   niceeval exp regression --output ci --strict --budget 25 \
     --json .niceeval/regression.json
   ```

2. 运行器只按**已完成 attempt 的实测花费**判断:同一 budget 域(experimentId)的花费到顶就停止派发新 attempt;已经在飞的照常跑完,不中途打断。到顶之前不做任何预测性节流,并发完全由并发参数决定(契约见 [Runner · 预算护栏](../../../runner.md#预算护栏budget))。
3. 到顶时三种 profile 都追加一条永久事件,CI 形态:

   ```text
   niceeval: budget_exhausted experiment=regression/codex spent=25.31 unstarted=4
   niceeval: result=incomplete passed=36 failed=0 errored=0 unstarted=4 duration=18m02s
   ```

4. 未派发的 attempt 计入完成状态的 `unstarted`,整次运行结论落在 `incomplete`、退出码 `1`——即使零 `failed` / `errored` 也不伪装全绿(见 [Runner · 完成状态](../../../runner.md#完成状态))。
5. 想补完分母时提高预算重跑同一条命令:已落盘的终态 attempt 按指纹携带、不重付,本次只派发缺失的序号(见 [Runner · 缓存](../../../runner.md#缓存指纹去重)):

   ```sh
   niceeval exp regression --output ci --strict --budget 40 \
     --json .niceeval/regression.json
   ```

## 边界

- budget 是防止无限烧钱的安全网,不是精确计费闸:已花 + 在飞未结算的总花费可能短暂超出上限;要压吞吐用 [`--max-concurrency`](max-concurrency.md)。
- 判断依据是 agent 报回的用量;连续多个已发起 agent turn 的 attempt 都拿不到成本数据时,budget 对该域不可执行,运行器给一条去重后的 warning,而不是每个 attempt 重复提示。首个 agent turn 之前失败的 attempt 没有成本事实,不产生这条 warning。
- 覆盖优先级是 CLI flag → `NICEEVAL_BUDGET` → experiment → config(见 [Library · 与 config 的关系](../library.md#与-config-的关系));判断仍按每个实验自己的 budget 域分别计。

## 相关阅读

- [Runner · 预算护栏](../../../runner.md#预算护栏budget) —— 到顶停止派发、在飞跑完、不可执行 warning 的单源。
- [CLI · CI 怎么用](../cli.md#ci-怎么用) —— `budget_exhausted` / `result=incomplete` 在门禁里的形态。
