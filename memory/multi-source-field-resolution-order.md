# 多来源字段的解析顺序没有单点声明 → `??` 链少一层没人会红

## 现象

`defineEval({ timeoutMs: 35 * 60_000 })` 声明的 eval 级超时在配了 `config.timeoutMs` 的项目里**完全不生效**:两条声明 35 分钟的安装型 eval 被 config 的 20 分钟掐死,报 `attempt timed out (1200000ms)`,两格全灭、白烧 20 分钟(2026-07-25 canary.10 首轮真机撞上)。没配 `config.timeoutMs` 的项目一切正常,所以问题在仓库自测和大部分示例里都看不见。

## 根因

`src/cli.ts` 组装 run 配置时写成 `timeoutMs: flags.timeout ?? exp.timeoutMs ?? config.timeoutMs`,把**兜底层提前塞进了 run 值**。下游 `src/runner/attempt.ts` 的 `run.timeoutMs ?? evalDef.timeoutMs ?? config.timeoutMs` 于是第一段就短路——`run.timeoutMs` 因为 config 有值而永远非空,`evalDef.timeoutMs` 这一层再也走不到。

真正的根因不是那一行写错,是**这条链当时没有任何一处文档定义过**:`docs/` 里 config / eval / experiment / `--timeout` 四处各自声明了自己有 `timeoutMs`,谁覆盖谁一句话都没有;`src/runner/fingerprint.ts` 的注释按 run → evalDef → config 写,`cli.ts` 按另一种理解写,两边不一致也没人能判定谁错。这类 bug 的固定形态是:

- 类型系统一次都拦不住——每层都是 `number | undefined`,多串一层 `??` 完全合法;
- 只有**同时配了两层**的项目才会露馅,单层配置的 fixture 与示例全绿;
- 症状出现在离改动很远的地方(超时报错),看不出是配置解析的问题——错误消息只说毫秒数,不说这个值来自哪一层。

## 修法

1. **契约先落地**:解析链单点声明在 `docs/feature/experiments/architecture.md` 的 [Resolved config] 节——`--timeout` → experiment → eval → config → 默认值,并写死「**config 是缺省底不是覆盖层,写了 config 不得使 eval 自己的声明失效**」;`docs/runner.md` 的 carry 资格判据与 `docs/feature/eval/README.md` 引用它,不各自复述。
2. **代码**:`src/cli.ts` 那行去掉 `?? config.timeoutMs`(`attempt.ts` 本来就兜底到 config)。
3. **测试**:`docs/engineering/testing/unit/experiments-runner.md` 声明了区分力最强的那一格——「config 有值 + experiment 没写 + eval 写了 → 取 eval 的值」。`??` 链少写一层时**只有这一格会红**,其余四格照常通过。
4. **诊断**:超时消息带来源标注(`timeout after 60000ms (from config)`),四值 `flag` / `experiment` / `eval` / `config`,写在 `AttemptError.message` 里(见 `docs/feature/experiments/cli.md` 的 timeout 段)。当初有这一句,整个排查一眼就完了。

## 适用场景

任何字段能从两处以上来的时候都适用,不限于 `timeoutMs`:`judge`(单次 `{ model }` → eval → config)、`locale`、并发上限都是同一形态。**先在 docs 定死链,再写 `??`**;链里有「兜底层」时特别检查它有没有被提前物化成上游的值。已升格为 CLAUDE.md 的一条规则(与 [optional-field-additions-need-call-site-census](optional-field-additions-need-call-site-census.md) 同源:类型系统拦不住的改动要靠普查和区分力测试兜)。
