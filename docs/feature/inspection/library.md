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

## 续读

Library 与 `show --json` 使用相同的 operation 和 continuation。
在 source、cutoff 和请求一致时，可把 CLI 返回的 token 交给 Library，也可将 Library 的 token 交给 CLI。
将每页 token 原样放入下一次 `inspect` 请求。遇到 `restart-required` 时，从第一页重新开始。

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
