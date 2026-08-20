# 小型深层 Assertion snapshot 不能以内联 shape 发布

## 现象

Assertion subject 不到 32 KiB，但捕获值超过内联 JSON 的递归深度。runtime 已写入 `depth-truncated` marker，producer 仍把整个 snapshot 当作 inline material，最终以 `assertions-document-invalid` 拒绝发布。

## 根因

Assertions material 只按 byteLength 决定 inline 或 blob，没有先用 durable `BoundedJsonValueSchema` 验证 shape。深度截断 marker 本身仍占一层，因此 runtime 的捕获边界与 durable schema 的递归边界相撞。

## 修法

subject / evidence snapshot 在 Record bridge 同时检查大小与 durable shape。超过 32 KiB 或不能通过 `BoundedJsonValueSchema` 时，完整 JSON bytes 都写入 Assertions-own blob；inline 分支只接收 schema 已验证值。

## 回归收据

owner 是 `docs/engineering/testing/e2e/eval.md#eval-assertion-values`。公开 Eval 登记一个九层对象的 `isDefined` Assertion。

- 旧候选 SHA-256 `b09b3b016d81b213244c76d14c2961ad3cf7d40b84bb3eb4ac19fcc549539997`：Record 发布报 `entries.15.subject.value` 超过 Assertions limits，artifact `/tmp/niceeval-e2e-artifacts-j4T1jS`。
- 修复候选 SHA-256 `e1231e0e332a3296d92b7f0c485eb4fdfe5c17d82430e243600f9558c6330a53`：Attempt passed，artifact `/tmp/niceeval-e2e-artifacts-WqZjK2`。
