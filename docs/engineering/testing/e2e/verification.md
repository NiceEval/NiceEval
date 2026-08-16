# 验收脚本写法

本页给场景仓库的 `scripts/e2e.ts` / `verify.ts` 一条最小参考链。脚本只运行公开 CLI、断言退出码和公开输出；不 import NiceEval 内部代码，不递归扫描 `.niceeval/`，也不读取 Record 私有文件。

自动化产品测试当前处于重置期。需要真实验收时沿本页手动执行最小切片；恢复自动化前仍须遵守测试总纲的 owner 与预算规则。

## 命令执行边界

命令以用户可复制的原文出现。唯一命令执行器只负责运行进程、收集 stdout/stderr 和核对预期退出码，不解码领域输出：

```ts
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

function sh(cmd: string, expected: number | "nonzero" = 0): string {
  const result = spawnSync(cmd, { shell: true, encoding: "utf8" });
  const actual = result.status ?? -1;
  const ok = expected === "nonzero" ? actual !== 0 : actual === expected;
  assert.ok(ok, `${cmd}\nexit ${actual}; expected ${expected}\n${result.stderr.slice(-2000)}`);
  return result.stdout;
}
```

预期失败是一等场景，不应由命令执行器吞掉。每条 assertion message 都要写明断掉的用户契约和下一条诊断命令。

## 最小 Journey

```text
exp --dry
  → exp
  → show --run <runId> --json
  → show --run <runId> --report <fixture-module> --page <fixture-route>
  → view --run <runId> [--run <runId> ...] --out <new-directory>
  → 断网浏览静态站
```

`runId` 来自本次 Invocation receipt 的公开输出。测试使用签入代表 Report 的字面模块与目标 route 调用 `show --page`，再用单目标 JSON 验证该 route、page identity、固定 locale 和 marker。`show --json` 不枚举页面或提供站点索引；参数 route 也不能越过已选 Sample 打开任意 Attempt。

```ts
const reportModule = "./reports/site.tsx";
const overviewRoute = "/";
const fixtureMarker = "Report fixture static site";

sh("pnpm exec niceeval exp main --dry --json");
const mainEvents = sh("pnpm exec niceeval exp main --rerun all --json");
const sourceEvents = sh("pnpm exec niceeval exp source --rerun all --json");
const mainRunId = parseCompletedRunId(mainEvents);
const sourceRunId = parseCompletedRunId(sourceEvents);

const document = JSON.parse(
  sh(
    `pnpm exec niceeval show --run ${mainRunId} --report ${reportModule} --page ${overviewRoute} --json`,
  ),
);
assert.equal(document.schema, "niceeval.report-target-execution/v1");
assert.equal(document.locale, "en");
assert.equal(document.page.route, overviewRoute);
assert.equal(document.page.pageId, "overview");
assert.ok(document.page.renderedText.includes(fixtureMarker));

const detail = sh(
  `pnpm exec niceeval show --run ${mainRunId} --report ${reportModule} --page ${overviewRoute}`,
);
assert.ok(detail.includes(fixtureMarker));

sh(`pnpm exec niceeval view --run ${mainRunId} --run ${sourceRunId} --report ${reportModule} --out ./report-site`);
await assertStaticSiteWorksOffline("./report-site", overviewRoute);
```

显式比较多个 Run 时重复 flag：

```sh
pnpm exec niceeval show --run <baseline-run> --run <candidate-run> --page /comparison
```

不带 locator 或 `--run` 的 `show` 以当前项目目标为准：扫描全部 published Run，保留每个身份仍匹配的 slot，不按时间缩成最后一个 Run。身份过期或无法验证的候选不进入当前 Sample；没有匹配结果时形成空 Sample。完整 `--run` 仍能读取历史 Run。

## Record 与 Report 验收点

- CLI 只进入 `reportHost`；它在内部经 `recordHost.openRead()` 和 `analysisHost.openSample()` 形成
  Sample。同 root writer 可并发发布；Scope 关闭后才形成 execution，本机 view/static export 不再访问 Record。
- Sample 保留 included、not-recorded、core-invalid、excluded 的完整分母；被请求 fixed family 的
  available、not-recorded、unsupported、invalid 四态不折叠成零或空值。
- Attempt 大内容从 owner-local blob closure 交付；family decoder 只能取得当前 owner 的 bytes，不能得到
  Record root 或实际路径。
- 静态 export 的目标必须不存在；任一页面或下载失败时不发布目标。成功目录在断网 Sandbox 实例中只读取 manifest 列出的自有文件。
- 已发布 Run immutable；外部损坏 fixed family 时，下一次命令呈现局部 invalid，不修改其它事实，也不建立 revision、history 或迁移结果。

## 缓存与补跑

缓存是否沿用由新 Run 的 Core Member action 与当前 reuse policy 共同观察，不通过跨 Run history 命令
推断。真实补跑后显式读取新 Run；reference Member 带 carried/accepted action 时，详情仍显示 Attempt
的原始 origin。

强制补跑的最小链是：

```sh
pnpm exec niceeval exp cached --rerun all --json
pnpm exec niceeval show --run <new-run-id> --page /adoption
```

## 失败分类

场景能确证 provider 429、5xx、连接失败或 readiness 超时，才可归外部基础设施；其余失败一律视为产品回归。归类依据必须来自自己的 preflight 或公开 NDJSON error event，不得读取 Record 私有文件反推。

## 不这样验收

- 不使用已删除的历史、位置 locator、独立 Attempt 或固定切片 flag；详情与切面都是 Report page。
- 不用后台监看或 session 查询恢复已退出 Invocation；长期事实必须已经进入 Run、Attempt Core 或固定 family。
- 不让 fixture 重写 Core validator、family decoder 或 Report Host，形成第二套真相依据。
- 不把多个可独立失败的产品结果放入同一个 Journey；跨域身份接线留在 Journey，单一错误矩阵回到对应 owner。
