# 台账:总纲图复制字段级形状,五处全漂移

**日期**:2026-07-26

## 现象

`docs/feature/reading/README.md` 的三层总纲图(磁盘 → Record → Sample → Reports)开篇就写着「各层
自己的契约仍单源在各层目录,这里不复制」,但图里三个数据框复制的正是字段级形状。逐条核对下来五处
与各层文档不符,而**没有一处落在本篇自己的内容**(分工、不变量、判据表)上:

1. `AttemptHandle` 的框里并排画了 `locator` / `verdict` / `assertions` 与 `run` / `ref`。前三者住在
   `attempt.result`(`record/architecture.md` 的 `AttemptRecord`),照图写脚本直接拿到 `undefined`。
2. `run.json` 顶层列了 `flags`,它住在 `experiment: ExperimentRunInfo` 里。
3. 磁盘路径示例 `.niceeval/midterm/bub-gpt-5.4/2026-07-26T10-03-11/` 违反两条命名规则:实验目录名是
   experimentId 清洗后的**一段**(`/` → `_`),run 目录名带 4 位随机后缀。
4. 「一次 niceeval exp = 一个 run」不成立——Run = 一个 Experiment 的一次执行,一条 CLI 命令跑多个
   实验就开多个 Run。
5. `MetricCell` 只画了 `value` / `display` / `refs`,恰好删掉 `samples` / `total`——而
   `reports/architecture.md` 把「覆盖率与证据链不可被渲染层丢弃」列为不变量,本篇不变量三讲的也正是
   这件事。

## 根因

总纲页的体裁诱导「画一张图让人一眼看懂数据长什么样」,而字段名是最省事的填充物。复制过来的那一刻起
它就只能靠人肉同步——各层文档改字段时没有任何守护会指向这张图(`pnpm test:docs` 查的是索引覆盖、
链接真实性与句长段长,不查字段是否存在)。漂移方向是单向的:被复制的部分全错,原创的部分全对。

## 修法

图只保留**类型名与层间调用**(`openRecord` → `latestKnown` → `*Data` → 组件树),字段级形状退回各层
文档;确实需要示意时收成一格写 `result: EvalResult`。图前加一句「图上只出现类型名与层间调用,字段级
形状看各层文档」,把体裁约束写进正文,下一个改这张图的人才不会又填字段。

同批修掉的跨文档冲突:`record/library.md` 说 `attempt.ref` 与「报告 `MetricCell.refs`、view 深链
同一身份」——实际 `MetricCell.refs` 与 view 深链都是不透明的 `AttemptLocator`,`ref` 是证据文件的
路径契约(导出站 `artifact/<run>/<attempt>/` 按它布局)。两个身份是两回事,原句把它们混成一个。
