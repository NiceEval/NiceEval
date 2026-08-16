# Git 检出隔离 —— Library

checkout 仍从 niceeval/sandbox 导出，并只可加入 SandboxLayer.prepare。

```ts
import { checkout } from "niceeval/sandbox";

interface CheckoutOptions {
  readonly repo: string;
  readonly commit: string;
  readonly into?: string;
}

declare function checkout(options: CheckoutOptions): StableSandboxCommand;

export default defineEval({
  sandbox: sandboxLayer().prepare(checkout({
    repo: "https://github.com/acme/fixture-repo",
    commit: "9e107d9d372bb6826bd81d3542a419d6",
  })),
  async test(t) {
    await t.send("完成仓库中的目标任务。");
  },
});
```

## 稳定错误码

link 错误与 prepare command 错误有不同 owner。前者属于 Eval declaration，后者属于本次 SandboxLayer command receipt；两者都使用稳定 code，不依赖 Git 或 transport 的原始文本。

```ts
type CheckoutLinkErrorCode =
  | "checkout.invalid-repo"
  | "checkout.invalid-commit"
  | "checkout.invalid-target"
  | "checkout.removed-option";

type CheckoutPrepareErrorCode =
  | "checkout.target-ownership-failed"
  | "checkout.target-cleanup-failed"
  | "checkout.target-replacement-failed"
  | "checkout.credentials-unavailable"
  | "checkout.credentials-rejected"
  | "checkout.transport-failed"
  | "checkout.commit-not-found"
  | "checkout.commit-not-a-commit"
  | "checkout.object-closure-invalid"
  | "checkout.submodule-present"
  | "checkout.lfs-present"
  | "checkout.worktree-validation-failed";
```

## 输入

repo 是不含 userinfo、token、query credential 或本机文件路径的远端 locator。它在 identity 与审计中以去凭据的规范形式保存。file URL、相对路径、绝对路径和含凭据 URL 都是作者输入错误。

commit 必须是完整、小写的 Git object ID。SHA-1 使用 40 个十六进制字符，SHA-256 使用 64 个十六进制字符。Runner 必须确认该对象是 commit；短 SHA、branch、tag、HEAD 和任意 ref 名都不属于输入语言。

into 省略时为工作目录根。给出时必须是非空、工作目录相对的 POSIX 目录路径，不能含 .、..、反斜线、控制字符或 symlink alias。

## 可见结果

成功命令只交付一个 detached Git worktree：

- HEAD 精确等于 commit；
- 所有可达 commit 都是 commit 的祖先；
- 所需 tree 与 blob 只来自这组可达 commit；
- 没有 local branch、remote-tracking ref、tag、remote URL、credential 配置或 object alternate；
- 目标 worktree 在交付时 clean，且没有 submodule 或 LFS materialization。

repo 中本身可达的历史内容仍是被声明 commit 的历史，不是 evaluator 私有资产。隐藏测试、solution、credential 与判分脚本不得借 checkout 进入工作目录。

## target 目录所有权

checkout 完整拥有 into。每次命令先在 private staging 中建立和验证新 checkout，再原子替换目标。旧目标只要属于这个 command occurrence 的工作目录，便会被移除而不会 merge、reset 或复用。

无法证明现有目标属于本 command、目标经过 symlink 逃出工作目录，命令以 `checkout.target-ownership-failed` errored。确认归属后仍无法安全移除旧目标时以 `checkout.target-cleanup-failed` errored；原子替换失败时以 `checkout.target-replacement-failed` errored。它不会把不明目录当作可删除 cache。

失败时 staging 被删除，Agent namespace 中不保留半成品 checkout。成功后 private staging、fetch 临时文件与 transport 进程变量集合也不会残留为 Agent 可读路径。

## submodule、LFS 与 credential

目标 commit 中出现 gitlink mode 160000 或 .gitmodules 时，checkout 以 checkout.submodule-present 失败。命令不初始化 submodule，也不隐式增加第二个 repo 或 commit 声明。

目标 tree 中出现 Git LFS pointer 时，checkout 以 checkout.lfs-present 失败。命令不运行 LFS smudge、fetch 或 checkout filter；LFS 对象不能绕过精确 Git 对象闭包进入 Agent namespace。

credential 只在 private transport 内短暂可用。缺失、过期或无法取得时产生 `checkout.credentials-unavailable`；远端拒绝已提供 credential 时产生 `checkout.credentials-rejected`。

其它 DNS、连接、协议或远端 transport 失败产生 `checkout.transport-failed`。Agent 看不到进程变量、askpass、SSH agent socket、credential file、Git config 或含凭据 URL。

## 删除的输入与路径

CheckoutOptions 不含 ref。不存在 ref、branch、tag、revision、depth、submodules、lfs、credentials 或收尾选项，也不存在 checkoutRef、cloneRepo、Sandbox resource factory 或 test 期等价 API。

调用方先把可移动引用确定为完整 commit，再写入声明。此替换没有兼容 overload、运行时自动转换或旧语义回退。

## 生产入口验收

1. niceeval check 必须拒绝非法 repo、非完整 commit 与非法 into，且不创建资源。
2. niceeval exp 必须在复用 Sandbox 的相邻 Attempt 中交付同一干净 detached commit。
3. 真实私有仓库必须证明 credential 不出现在 Agent 可见 Git、进程变量集合、mount、cache 或 show 输出。
4. 含 submodule、LFS pointer、脏目标与 object alternate 的输入必须全部拒绝并删除自己的临时目录。
