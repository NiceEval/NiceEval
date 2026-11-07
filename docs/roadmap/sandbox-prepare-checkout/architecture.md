# Git 检出隔离 —— Architecture

checkout 把 Git transport、object cache、target 准备与 Agent 可见 checkout 分成四个不重叠的边界。

## 数据与 namespace

| 区域 | owner | Agent 是否可达 |
| --- | --- | --- |
| repo locator 与 full commit | command declaration | 可审计，不含 credential |
| transport credential、askpass、SSH material | runner / provider private boundary | 否 |
| bare object cache 与 fetch lock | 物理 Sandbox private namespace | 否 |
| per-Attempt staging | command occurrence private namespace | 否 |
| detached worktree | Agent workspace | 是 |

private cache 不能是 workdir 的隐藏子目录、bind mount、volume、Git alternates 目标、Agent HOME、PATH 项或任何 Agent 进程可见祖先。权限位不是唯一防线；provider namespace 与 mount plan 也必须使其物理不可达。

## 建立目标目录

```text
validate declaration
  -> normalize redacted repo locator
  -> acquire private cache lock
  -> private transport fetches declared commit
  -> prove commit object and ancestor closure
  -> build a fresh filtered object store
  -> reject gitlink and LFS pointer tree entries
  -> create detached clean worktree in private staging
  -> validate HEAD, refs, objects, config and cleanliness
  -> atomically replace owned target
  -> erase staging and private transport material
```

private cache 可以包含 fetch 所需的临时对象，但不会直接给 Agent 使用。交付前从声明 commit 的可达闭包重新构造 fresh object store，禁止 alternates、hardlink、reflink 或共享 object directory。

## 精确 Git 验证

交付前的 verifier 必须同时证明：

1. commit 是声明算法的完整 object ID，并被确认是 commit object。
2. HEAD 是 detached，且值逐字节等于声明 commit。
3. 所有 refs、remote-tracking refs、tags 与 local branches 均不存在。
4. 由 Agent 可枚举的 commit object 只属于声明 commit 的递归 parent closure。
5. 由这些 commit 可达的 tree 与 blob 是唯一允许的非 commit 对象；不存在 unreachable object、alternate 或 promisor 回退。
6. .git/config、进程变量集合与 hook 路径不含 transport credential、remote、credential 配置或 Agent 可调用的网络补取配置。
7. git status --porcelain 为零，目标目录没有来自旧 Attempt 的未跟踪、修改或冲突内容。

verifier 在 private staging 完成检查。任何一项失败都会销毁 staging 并拒绝交付目标。

## 稳定失败语义

prepare command receipt 的 `code` 使用 [Library](library.md) 的 CheckoutPrepareErrorCode，不能把 Git、SSH、HTTP 或文件系统的原始文本作为公开分类。

| code | 唯一失败边界 |
| --- | --- |
| `checkout.target-ownership-failed` | 不能证明目标属于本 command、目标被 symlink 替换或路径越出工作目录 |
| `checkout.target-cleanup-failed` | 已确认归属的旧目标无法安全移除 |
| `checkout.target-replacement-failed` | private staging 未能原子替换已确认归属的目标 |
| `checkout.credentials-unavailable` | transport 所需 credential 缺失、过期或 private boundary 无法取得 |
| `checkout.credentials-rejected` | 远端明确拒绝已提供 credential |
| `checkout.transport-failed` | 非 credential 类的 DNS、连接、协议或远端 transport 失败 |
| `checkout.commit-not-found` | 远端可达但没有声明的完整 commit object |
| `checkout.commit-not-a-commit` | 声明 object 存在却不是 commit |
| `checkout.object-closure-invalid` | 祖先、tree/blob、alternate、promisor 或未交付 object 验证失败 |
| `checkout.submodule-present` | tree 含 gitlink 或 `.gitmodules` |
| `checkout.lfs-present` | tree 含 Git LFS pointer |
| `checkout.worktree-validation-failed` | HEAD、refs、config、cleanliness 或交付后 worktree 验证失败 |

每一种失败都删除本 command 的 staging；只有经过 ownership 证明的 target 才可删除。receipt 只公开 code、阶段与安全修法，不公开 credential、private path 或原始 transport 文本。

## target 删除与复用

Sandbox reuse 先恢复 workdir reset point，再执行每条 Attempt 的 prepare。checkout 不依赖上一条 Attempt 是否成功，也不使用 Git reset、Git clean 或 merge 来恢复目标。

command 通过私有 ownership receipt 和目录文件描述符确认 into 仍在本 Attempt 的工作目录内。发现 Agent 写入的 symlink、替换目录或跨根路径时，以 `checkout.target-ownership-failed` 失败并退休不能证明干净的物理 Sandbox；已确认归属却无法删除旧目标时以 `checkout.target-cleanup-failed` 失败。

删除失败不保留含糊 checkout。它产生稳定 receipt code，并使共享 Sandbox 不得继续承接下一条 Attempt。

## submodule、LFS 与 credential 边界

gitlink 和 .gitmodules 表示需要第二个 repository closure。Git LFS pointer 表示需要 Git object 之外的下载。二者均违反单一 repo、精确 commit 的交付边界，因此必须在 Agent 获取 staging 前失败。

credential transport 的输入、secret、socket、配置与网络日志只能留在 private transport。transport 完成后删除进程变量和临时文件；worktree .git 也不能保留可以重新认证或重新联系 remote 的配置。

## 并发、失败与收尾

private fetch lock 的范围仅限于同一物理 Sandbox 的同一 repo + commit。持锁等待属于 Attempt deadline，取消时不删除另一个 holder 的 cache 或 staging。

每个 Attempt 的 target swap、ownership receipt 和删除步骤独立。失败只删除本 command 的 staging 与已确认 owned target，绝不递归删除不明宿主路径或其它 Attempt 的目录。

## 生产入口验收

| 入口 | 必须证明 |
| --- | --- |
| niceeval check | 完整 commit、repo locator 与 into 的静态拒绝语义 |
| niceeval debug | 去凭据 plan；不执行 runtime callback 或创建 Sandbox，但 Provider planner 可做只读查询 |
| niceeval exp | 精确 HEAD、祖先闭包、干净重复执行、并发锁与 cache 不可达 |
| niceeval query / view | receipt 可审计，credential、private path 与未交付对象不泄露 |
| 真实 Git fixture | submodule、LFS pointer、认证失败、脏目标、symlink target 与 alternate 全部被拒绝 |
