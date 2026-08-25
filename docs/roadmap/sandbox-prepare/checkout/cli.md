# Git 检出隔离 —— CLI

本方向不新增 CLI 命令或 flag。checkout 继续由 `niceeval check`、`niceeval exp`、`niceeval debug`、机器 `niceeval query` 与人用 `niceeval view` 观察。

## 人类输出

dry command plan 展示声明事实与隔离边界：

```text
checkout
  repo       github.com/acme/fixture-repo
  commit     9e107d9d372bb6826bd81d3542a419d6
  target     .
  cache      private to physical Sandbox
  exposure   detached commit and ancestors only
  submodule  rejected
  lfs        rejected
```

执行失败显示安全有界的真实错误，不回显 credential、私有 cache 路径、完整 transport stderr 或 Agent 不可见对象名。

```text
error: The declared commit contains a Git submodule, which this checkout does not support.
```

## JSON

command plan 的 checkout 节点使用下列稳定形状：

```ts
interface CheckoutCommandPlan {
  readonly kind: "checkout";
  readonly repo: string;
  readonly commit: string;
  readonly target: string;
  readonly cache: "private-physical-sandbox";
  readonly exposure: "declared-commit-and-ancestors";
  readonly submodules: "rejected";
  readonly lfs: "rejected";
}
```

成功 receipt 只附加可审计的交付状态：

```ts
interface CheckoutReceipt {
  readonly repo: string;
  readonly commit: string;
  readonly target: string;
  readonly head: string;
  readonly worktree: "clean";
  readonly refs: "detached-only";
  readonly objectClosure: "declared-commit-and-ancestors";
  readonly cache: "private";
}
```

失败 receipt 使用 [Library](library.md) 的 CheckoutPrepareErrorCode：

```ts
interface CheckoutCommandError {
  readonly code: CheckoutPrepareErrorCode;
  readonly phase: "target" | "transport" | "verification";
}
```

repo 始终是去凭据 locator。JSON 不含 remote URL userinfo、credential 机制、private cache/staging 路径、Git pack、未交付对象或原始服务器响应。

## exit code 与 dry 边界

| 情况 | exit code | 行为 |
| --- | --- | --- |
| 合法的 check 或 dry 计划 | 0 | 不访问远端、不获取 credential、不建立 cache |
| 非法 repo、commit、into 或已删除字段 | 2 | 在 link 前终止 |
| 目标归属、删除或替换失败 | 1 | `checkout.target-ownership-failed`、`checkout.target-cleanup-failed` 或 `checkout.target-replacement-failed` |
| credential 缺失、过期、不可用或被远端拒绝 | 1 | `checkout.credentials-unavailable` 或 `checkout.credentials-rejected` |
| 其它远端 transport 失败 | 1 | `checkout.transport-failed` |
| commit、对象闭包、submodule、LFS 或 worktree 验证失败 | 1 | `checkout.commit-not-found`、`checkout.commit-not-a-commit`、`checkout.object-closure-invalid`、`checkout.submodule-present`、`checkout.lfs-present` 或 `checkout.worktree-validation-failed` |

dry 显示声明的 commit，不能证明远端含有该对象，也不报告 live cache hit。它不把静态可计划性表达成实际网络可用性或 credential 可用性。

## 并发与审计

同一物理 Sandbox 内，相同规范化 repo 与 commit 共享一把 private fetch lock。锁只避免重复私有 fetch；每个 Attempt 仍在自己的 staging 和目标目录中独立建立 checkout。

不同物理 Sandbox、Provider、Run、机器或 Agent namespace 不共享 cache、lock、credential、worktree 或对象目录。并发 Attempt 不会把一个目标的脏状态、remote refs 或删除结果传给另一个目标。

`niceeval view` 读取 sealed command receipt。机器读取通过 `niceeval query` 取得同一类 sealed facts；两者都不打开 private cache，不调用 Git 远端，也不在留存 Sandbox 上重新验证或修复 checkout。
