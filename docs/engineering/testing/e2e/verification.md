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
  → query discover
  → query explain --request <request>
  → query run --request <request>
```

`runId` 与 `publicationCutoff` 来自本次 Invocation receipt 的公开输出。测试先发现 catalog，再使用签入的完整 request 调用 `query explain` 和 `query run`，验证 operation identity、固定 cutoff、denominator、issues 与 Evidence。View 的启动、ready、浏览器断言、signal 与 `closed` lifecycle 由 [Report E2E owner](report.md)的 browser Journey 单独验收；它不提供机器协议或页面索引。

```ts
sh("pnpm exec niceeval exp main --dry --json");
const mainEvents = sh("pnpm exec niceeval exp main --rerun all --json");
const sourceEvents = sh("pnpm exec niceeval exp source --rerun all --json");
const mainRunId = parseCompletedRunId(mainEvents);
const sourceRunId = parseCompletedRunId(sourceEvents);

const document = JSON.parse(
  sh("pnpm exec niceeval query run --request ./overview.request.json"),
);
assert.equal(document.protocol, "niceeval.query/v1");
assert.equal(document.operation, "run.get");
assert.ok(document.summary.denominator);
```

显式比较多个 Run 时重复 flag：

```sh
pnpm exec niceeval query run --request ./comparison.request.json
```

## Run、Inspection 与 View 验收点

- CLI 的 Inspection Host 在一个固定 PublicationCutoff 的短 scope 内执行 operation。query 和 View 都只消费其关闭结果；operation 返回前 reader 已关闭。
- operation 保留 selected、not-recorded、invalid、excluded 的完整分母；被请求 fixed family 的
  available、not-recorded、unsupported、invalid 四态不折叠成零或空值。
- Attempt 大内容从 owner-local blob closure 交付；family decoder 只能取得当前 owner 的 bytes，不能得到
  SQLite root 或实际路径。
- query 与 View 统一读取 PublicationCutoff；用户不能提交 SQLite copy、snapshot path 或 generation 作为读取输入。
- 已发布 Run immutable；外部损坏 fixed family 时，下一次命令呈现局部 invalid，不修改其它事实，也不建立 revision、history 或迁移结果。

## 缓存与补跑

缓存是否沿用由新 Run 的 Core Member action 与当前 reuse policy 共同观察，不通过跨 Run history 命令
推断。真实补跑后显式读取新 Run；reference Member 带 carried/accepted action 时，详情仍显示 Attempt
的原始 origin。

强制补跑的最小链是：

```sh
pnpm exec niceeval exp cached --rerun all --json
pnpm exec niceeval query run --request ./adoption.request.json
```

## 失败分类

场景能确证 provider 429、5xx、连接失败或 readiness 超时，才可归外部基础设施；其余失败一律视为产品回归。归类依据必须来自自己的 preflight 或公开 NDJSON error event，不得读取 Record 私有文件反推。

## 不这样验收

- 机器详情只通过固定 query request，深读只用 View；测试不为读取面增加 selector、作者配置或导出路径。
- 不用后台监看或 session 查询恢复已退出 Invocation；长期事实必须已经进入 Run、Attempt Core 或固定 family。
- 不让 fixture 重写 Core validator、family decoder 或 Inspection Host，形成第二套真相依据。
- 不把多个可独立失败的产品结果放入同一个 Journey；跨域身份接线留在 Journey，单一错误矩阵回到对应 owner。
