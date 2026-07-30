# 多来源字段的解析顺序没有单点声明 → `??` 链少一层没人会红

## 现象

`defineEval({ timeoutMs: 35 * 60_000 })` 声明的 eval 级超时在配了 `config.timeoutMs` 的项目里**完全不生效**:两条声明 35 分钟的安装型 eval 被 config 的 20 分钟掐死,报 `attempt timed out (1200000ms)`,两格全灭、白烧 20 分钟(2026-07-25 canary.10 首轮真机撞上)。没配 `config.timeoutMs` 的项目一切正常,所以问题在仓库自测和大部分示例里都看不见。

## 根因

`src/cli.ts` 组装 run 配置时写成 `timeoutMs: flags.timeout ?? exp.timeoutMs ?? config.timeoutMs`,把**兜底层提前塞进了 run 值**。下游 `src/runner/attempt.ts` 的 `run.timeoutMs ?? evalDef.timeoutMs ?? config.timeoutMs` 于是第一段就短路——`run.timeoutMs` 因为 config 有值而永远非空,`evalDef.timeoutMs` 这一层再也走不到。

真正的根因不是那一行写错,是**这条链当时没有任何一处文档定义过**:`docs/` 里 config / eval / experiment / `--timeout` 四处各自声明了自己有 `timeoutMs`,谁覆盖谁一句话都没有;`src/runner/fingerprint.ts` 的注释按 run → evalDef → config 写,`cli.ts` 按另一种理解写,两边不一致也没人能判定谁错。这类 bug 的固定形态是:

- 类型系统一次都拦不住——每层都是 `number | undefined`,多串一层 `??` 完全合法;
- 只有**同时配了两层**的项目才会露馅,单层配置的 fixture 与示例全绿;
- 症状出现在离改动很远的地方(超时报错),看不出是配置解析的问题——错误消息只说毫秒数,不说这个值来自哪一层。

## 修法(逐项标注落地状态,2026-07-30 核对)

1. **契约先落地**(已落,commit 49bb1f33,随 v0.11.3 发布):解析链单点声明在 `docs/feature/experiments/architecture.md` 的「配置解析链」节——`--timeout` → experiment → eval → config → 默认值,并写死「**config 是缺省底不是覆盖层,写了 config 不得使 eval 自己的声明失效**」;`docs/runner.md` 的 carry 资格判据与 `docs/feature/eval/README.md` 引用它,不各自复述。
2. **代码**(已落地,2026-07-30):解析链单点收进新建 `src/runner/timeout.ts`(运行侧 `resolveRunTimeout` 不含 config 层、attempt 侧 `resolveAttemptTimeout` 补 eval → config),`cli.ts` 那层提前物化删除;`run.ts` 复用池寿命与 `fingerprint.ts` 携带判据同源消费。同批按契约删掉了链末端藏着的 600s 内置默认(表格写「无上限」),四层全缺就不设 deadline。
3. **测试**(已落地,2026-07-30):`src/runner/attempt.test.ts` 五行区分力矩阵(flag/experiment/eval/config/无上限),断真实 deadline 而非配置值;变异自检确认链改回旧写法时恰好 eval/config/无上限三行红。
4. **诊断**(已落地,2026-07-30):超时消息带来源(`attempt 超时(1200000ms, from config)`),四值 `flag`/`experiment`/`eval`/`config`;`FLAG_OPTIONS` 的 `--timeout` JSDoc 补齐 eval 层与「默认无上限」,`pnpm docs:reference` 已重生成 cli.mdx 区块(`docs-site/zh/reference/cli.mdx` 手写段的同步另行处理)。

**这条 memory 曾把修法写得像已完成**——2026-07-30 MemoryBench(niceeval 0.11.3)dogfooding 再次真机撞上同一 bug(声明 31 / 36 分钟的 eval 被 config 的 20 分钟掐死,报错无来源),回查才发现只有契约落了。docs 先于代码定稿是正常流程,但 memory 台账必须区分「契约已定」与「代码已修」。

## 适用场景

任何字段能从两处以上来的时候都适用,不限于 `timeoutMs`:`judge`(单次 `{ model }` → eval → config)、`locale`、并发上限都是同一形态。**先在 docs 定死链,再写 `??`**;链里有「兜底层」时特别检查它有没有被提前物化成上游的值。已升格为 CLAUDE.md 的一条规则(与 [optional-field-additions-need-call-site-census](optional-field-additions-need-call-site-census.md) 同源:类型系统拦不住的改动要靠普查和区分力测试兜)。
