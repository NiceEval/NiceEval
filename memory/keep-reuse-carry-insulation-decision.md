# 裁决:执行模式 flag(keep/reuse)与携带、并发 flag 的组合(2026-07-21)

## 现象(为什么需要裁决)

设计审计发现契约断层:`--keep-sandbox` / `--reuse-sandbox` 与缓存携带的交互无人认领,而 `failed` / `passed` 是可携带终态。keep 的两篇用例(hypothesis-loop、outside-workdir)的前提恰恰是「刚失败/刚通过、什么都没改、重跑拿现场」——按当时契约会被携带吃成零派发,没有沙箱、没有现场,文档旅程实际走不通。另:显式 `--max-concurrency` 与 `--reuse-sandbox` 组合行为未声明(只写了「并发钉成 1」),静默吃掉显式 flag 违反「不静默降级」。未实装即修约(reuse 未实现,keep 已实现但携带豁免缺失)。

## 裁决

1. **keep:留存档内不携带。** `--keep-sandbox` 运行里,历史终态 verdict 落在当前留存档内的 attempt 不参与携带、照常派发重跑(`failed` 档豁免 `failed`;`all` 档豁免 `passed`+`failed`);档外照常携带省钱。落点:`docs/runner.md` 缓存节、`docs/feature/sandbox/cli.md`。
2. **reuse:与缓存双向绝缘。** 出向已定稿(打 `reuse` 标记不成为命中),补入向:复用 run 不消费携带,快照只有一种出身;`--force` 组合冗余但合法。落点:`serial-reuse.md` 组合节。
3. **显式 `--max-concurrency` × `--reuse-sandbox` = 创建前用法错误,与值无关**(`--max-concurrency 1` 也报,报错教「并发这个输入面在复用模式下不存在」);环境层缺省(env/配置/provider 推荐值)被覆盖为 1 并在 PLAN 标注。落点:`serial-reuse.md`「串行是本质」节。
4. **调度 flag 作用域进契约表。** `experiments/cli.md`「哪些参数改变什么」表加「作用域」列(`--runs` 每 eval、`--max-concurrency` 全局、`--timeout` 每 attempt、`--budget` 每域);`runner.md` 预算护栏首句改为按域领跑,`--budget` 不是总闸(N 个实验 = N 份上限)。

## 曾选方案与否决理由

- **让用户配 `--force` 拿现场** —— 否决:`--force` 是全量重验语义,把「要现场」翻译成「全选重跑」既贵又靠暗规则,用例文档一篇都没提它,说明设计者自己也不会想到。
- **keep 全量不消费携带** —— 否决:`failed` 档下 `passed` 携带无害且省钱;档内豁免已精确对齐「要现场就真实执行」的意图。
- **reuse 消费携带以更省** —— 否决:快照混「干净携带 + 污染复用」两种出身,`runs > 1` 分布口径分裂。
- **`--max-concurrency` 静默钉 1** —— 否决:违反「不静默降级」;**值=1 放行** 也否决:按值分支让契约复杂化,报错本身在教模式本质。

实现 PLAN:`plan/execution-mode-flags-cache-and-concurrency.md`。
