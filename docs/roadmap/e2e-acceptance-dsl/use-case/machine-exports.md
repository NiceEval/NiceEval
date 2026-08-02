# Use Case：JSON、NDJSON 与 JUnit

## 目标

机器出口按字段身份和结果语义比较。只有公开逐字承诺的短文本使用 scrubbed golden。

## 完整测试

```ts
// test/behavior/read-results/machine-exports.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reportBehavior } from "../../support/behavior";
import {
  cli,
  jsonSummary,
  junitReport,
  ndjsonEvents,
  expectObserved,
} from "../../support/readback";
import {
  machineSummaryIsComplete,
  junitKeepsVerdictKinds,
  eventStreamReachesCompletion,
  grepNoMatchText,
} from "../../support/behaviors";

reportBehavior(machineSummaryIsComplete, async ({ w }) => {
  const run = await cli(
    "pnpm exec niceeval show --json",
    { cwd: w.consumerDir("report"), pipe: true },
  );
  const summary = jsonSummary(run.stdout);

  expectObserved(summary.fieldNames())
    .toShowExactRows(["evals", "runId", "totals"]);
  expectObserved(summary.evalIds())
    .toShowExactRows(["tool-call", "te-fail"]);
  expectObserved(summary.eval("te-fail").verdict())
    .toEqualValue("failed");
});

reportBehavior(junitKeepsVerdictKinds, async ({ w }) => {
  const junit = junitReport(readFileSync(
    join(w.consumerDir("report"), "junit.xml"),
    "utf8",
  ));

  expectObserved(junit.caseIds())
    .toShowExactRows(["deliberate-fail/gate", "deliberate-error/boom"]);
  expectObserved(junit.case("deliberate-fail/gate").outcomeTag())
    .toEqualValue("failure");
  expectObserved(junit.case("deliberate-error/boom").outcomeTag())
    .toEqualValue("error");
});

reportBehavior(eventStreamReachesCompletion, async ({ w }) => {
  const run = await cli(
    "pnpm exec niceeval exp main --rerun all --json",
    { cwd: w.consumerDir("report"), pipe: true },
  );
  const events = ndjsonEvents(run.stdout);

  expectObserved(events.experiment("main").terminalState())
    .toEqualValue("completed");
  expectObserved(events.attemptIds()).toShowRows(["tool-call"]);
});

reportBehavior(grepNoMatchText, async ({ w }) => {
  const run = await cli(
    "pnpm exec niceeval show tool-call --grep zzz",
    { cwd: w.consumerDir("report") },
  );
  expectObserved(run.stdoutText())
    .toMatchScrubbedFileSnapshot("golden/grep-no-match.txt");
});
```

## 边界

JSON 与 XML 的缩进、属性顺序和空白不进入契约。`fieldNames()` 承担字段全集检查。
NDJSON 逐行解析，截断或 malformed 行在 observe 阶段报告字节位置和 evidence 文件。
