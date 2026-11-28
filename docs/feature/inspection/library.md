# Inspection Library

在 Node.js 中，用 `niceeval/inspection/host` 的 `withInspectionQuery` 从 Record 读取固定 Inspection operation。
协议的 Schema、请求解码与结果类型由 `niceeval/inspection` 提供，浏览器也可使用该协议入口。

## 单个读取作用域

```ts
import type { InspectionQuery } from "niceeval/inspection";

declare function withInspectionQuery<A>(
  input: { readonly cwd: string; readonly recordPath?: string },
  read: (query: InspectionQuery) => A | Promise<A>,
): Promise<A>;
```

`cwd` 指向项目目录。省略 `recordPath` 时读取项目 Record，指定时按 CLI `--record` 的规则读取外部 Record。
查询对象通过 `inspect(operation)` 执行固定 operation，返回对应的成功 document。失败时 Promise 拒绝。

一次调用固定一个 `PublicationCutoff`。Host 在回调返回或失败后释放 reader。
回调必须等待自己发起的查询完成。作用域外调用已取得的 query 会拒绝。
每次调用拥有独立 reader，当前项目目标仍通过 CLI 或 View 读取。

## Attempt 安装事实 {#attempt-install-facts}

`query.inspect({ kind: "attempt.get", locator })` 在结果的 `attempt.agentInstall` 字段返回已封存的 Agent 安装事实。
其身份由 Agent 名、精确版本和安装修订组成。修复成功时，`probeMissReason` 说明为何需要修复。
`repairFailureReason` 适用于就地修复失败后重装成功的情况，即使该原因与 `probeMissReason` 相同也保留。

```ts
type AgentIdentity = { readonly agent: string; readonly version: string; readonly revision: string };
type AgentInstallFact =
  | { readonly outcome: "hit"; readonly identity: AgentIdentity }
  | { readonly outcome: "repaired"; readonly identity: AgentIdentity; readonly probeMissReason: string }
  | {
      readonly outcome: "installed";
      readonly identity: AgentIdentity;
      readonly probeMissReason: string;
      readonly repairFailureReason?: string;
    };
type AgentInstallRead =
  | { readonly state: "available"; readonly value: readonly AgentInstallFact[] }
  | { readonly state: "unavailable"; readonly reason: "not-recorded" | "invalid" };
```

`not-recorded` 表示 Record 缺少该 attachment。无法解码已保存的 attachment 时返回 `invalid`。
封存规则见 [Attempt 安装事实](../adapters/architecture/agent-install.md#attempt-install-facts)。

## 续读

Library 与 `show --json` 使用相同的 operation 和 continuation。
在 source、cutoff 和请求一致时，可把 CLI 返回的 token 交给 Library，也可将 Library 的 token 交给 CLI。
将每页 token 原样放入下一次 `inspect` 请求。遇到 `restart-required` 时，从第一页重新开始。

工具命令预览超限时，`argv.evidenceId` 指向已封存的逻辑 argv。较长的 tool-call 详情也在 `command.content` 返回该证据身份与长度。
用 `attempt.trace.detail` 的 `execution-evidence` selector 读取这个身份。下一页的 `offset` 使用上一页的 `nextOffset`。
将各页 `base64` 解码并按顺序拼接后，再按 UTF-8 JSON 解码 executable、args 与归一方式。

```ts
import { withInspectionQuery } from "niceeval/inspection/host";

const runIds = await withInspectionQuery({ cwd: process.cwd() }, async (query) => {
  const ids: string[] = [];
  let continuation: string | undefined;
  do {
    const page = await query.inspect({
      kind: "run.list",
      ...(continuation === undefined ? {} : { continuation }),
    });
    ids.push(...page.runs.map(({ runId }) => runId));
    continuation = page.continuation;
  } while (continuation !== undefined);
  return ids;
});
```
