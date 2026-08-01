# Use Case · 机器出口:结构比较,与逐字比对的分界

## 场景

`--json` 机器摘要、`exp --json` 事件流、JUnit 出口与错误 / 用法文案都是给机器或给用户逐字读的表面。
它们的共同点只有「窄」,契约形态却是两种:前三者的契约是**字段身份与结果语义**,最后一种的契约是**那几个字**。
现行写法把两种混成一种,还都停在子串探测上。

## 现行断言

摘自 `e2e/report/scripts/verify-format.ts`、`e2e/cli/scripts/verify.ts`、`verify-readback.ts`:

```ts
// ① JUnit 折叠:逐子串探测
assert.ok(failXml.includes("<failure"), "...");
assert.ok(!failXml.includes("<error"), "...");

// ② --json 摘要:手工逐字段断言,覆盖到哪算哪
const summary = JSON.parse(readFileSync("summary.json", "utf8"));
assert.equal(summary.evals.length, 2, "...");

// ③ 空结果文案:整份输出全等——这是罕见的「现行写法已经对了」
assert.equal(noMatches, "0 matches in 1 attempt\n", "...");
```

①② 的问题不是脆,是**覆盖有洞**:子串探测证明「出现过」,证明不了「没有多余的、结构对的」;新增字段悄悄漂移不会被发现。
③ 的方向对,但每处手写全等没有归一与更新流。

## 候选写法

机器出口 parse 之后按结构语义比较,「不多不少」由字段集合的显式断言承接:

```ts
reportBehavior(junitFoldsFailedAndErroredSeparately, async () => {
  await cli("pnpm exec niceeval exp deliberate --force --junit fail.xml", { expect: "nonzero" });
  const junit = junitReport(readFileSync("fail.xml", "utf8"));

  expectObserved(junit.caseIds()).toShowExactRows(["deliberate-fail/gate", "deliberate-error/boom"]);
  expectObserved(junit.case("deliberate-fail/gate").outcomeTag()).toEqualValue("failure");
  expectObserved(junit.case("deliberate-error/boom").outcomeTag()).toEqualValue("error");
  expectObserved(junit.counts()).toEqualValue({ tests: 2, failures: 1, errors: 1 });
});

reportBehavior(jsonSummaryKeepsEveryDeclaredField, async () => {
  const summary = jsonSummary(readFileSync("summary.json", "utf8"));
  expectObserved(summary.fieldNames()).toShowExactRows(["evals", "runId", "totals"]);
  expectObserved(summary.evalIds()).toShowExactRows(["tool-call", "te-fail"]);
  expectObserved(summary.eval("te-fail").verdict()).toEqualValue("failed");
});

reportBehavior(grepWithoutMatchesPrintsTheDeclaredSentence, async () => {
  const { stdout } = await cli("pnpm exec niceeval show tool-call --grep zzz");
  await expect(stdout).toMatchScrubbedFileSnapshot("golden/grep-no-match.txt");
});
```

- `fieldNames()` 加 `toShowExactRows` 承接整段 golden 原本的「不多不少」职责:漂移进来的新字段、丢失的字段一样现形。
  换来的是序列化顺序、缩进与空白不进契约——这些 JSON 与 XML 都不承诺。
- JUnit 的折叠规则(`failed` 对应 `<failure>`、`errored` 对应 `<error>`)按 case 身份逐条声明,不靠「出现过 `<failure`」这种子串反推。
- ③ 保留逐字比对:`0 matches in 1 attempt` 是[逐字承诺的短文本](../README.md#逐字比对的适用面),scrub 与更新流由 matcher 统一提供。
- `exp --json` 的生命周期事件走 `ndjsonEvents(stdout)`,逐行按事件身份解析,不整份 parse 也不整份 golden。

## 回归剧本

| 真实踩坑 | 现象 | 新写法在哪一步红 |
|---|---|---|
| [`show --json` 进管道时截断](../../../../memory/show-json-pipe-truncated-at-128k.md) | 重定向到文件是完整 JSON,管给 `jq` 只剩 128KB;下游报「JSON 语法错误」,第一反应会去怀疑自己的解析脚本 | observe 阶段:`cli(…, { pipe: true })` 走真实管道,`jsonSummary()` 的 parse 失败按 observe 阶段报告,指名是 niceeval 的输出被截断,而不是断言不符 |
| [退出码曾按 attempt 计红](../../../../memory/cli-exit-code-attempt-level-not-eval-level.md) | `runs: 2` 重试吸收抖动后两条 eval 全部通过,进程退出码仍是 1,与「重试吸收单次抖动」的设计意图矛盾 | outcome 阶段:同一个主证明同时声明 process-result 与 json 两个观察,一条断言写 eval 折叠后全绿则退出码为 0,另一条写 summary 顶层保持 attempt 级原始计数 |

第二条也说明了为什么两个口径要写进同一个主证明。
拆成两个测试时,「退出码正确」与「summary 计数正确」各自通过,而它们之间那条真正的契约(两个口径故意不同,消费方该按 eval 折叠)从未被任何断言表达。

## 边界

- **结构比较适用**:JSON、NDJSON 事件流与 JUnit——契约是字段身份、集合关系与结果语义。
- **逐字比对适用**:`--grep` 空结果、错误与用法文案、`--help` 用法块、品牌链接——每个字符都写进公开文档。
  渲染大面(报告页、attempt 详情)两者都不适用,那是结构读面的领域,整页上 golden 等于把脆断言搬进数据文件。
- scrub 后逐字符全等,没有行内通配;需要行级容差说明这个表面不够窄稳,换结构读面。
</content>
