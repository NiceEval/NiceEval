# `--reuse-sandbox`:把一批 eval 改成能进热道

拿一个真实的 eval 仓库走一遍:MemoryBench(用 niceeval 评 coding agent 记忆条件的仓库)
的 `evals/toggl-cli/` 链——6 道题,同一个 repo、同一个 base commit、同一套 Rust 工具链。
它是最该吃到串行复用的形状,而按现在的写法进不了热道。本篇按它的四处写法讲怎么改,
以及改完之后省下的是哪一段。

契约在[串行复用](../serial-reuse.md),机器判的硬门在[另外三篇](README.md#--reuse-sandbox串行复用)。
本篇只讲作者侧:同一批 eval 怎么写才能共享一个
[复用 Sandbox 的题间重置点](../serial-reuse.md#复用-sandbox-的题间重置点一次装好后续只重置到这里)。

## 1. clone 到 workdir 根:第二题会撞上活下来的 `.git`

`evals/toggl-cli/harness.ts` 的 `prepareRepo(t)` 在 `test(t)` 里把真实仓库 clone 到
workdir 根:

```ts
`git clone -q -o origin ${REPO_URL} .toggl-clone`,
"mv .toggl-clone/.git .git",
"rm -rf .toggl-clone",
`git reset -q --hard ${BASE_COMMIT}`,
```

题间重置清不掉这个 `.git`:分类账的排除清单在任意深度排除 `.git`,而 `git clean`
尊重这份清单(见[变更归因](../architecture.md#变更归因send-窗口与分类账))。所以第二题
的 `mv` 会把新 clone 的 `.git` 塞进上一题留下的那个目录里,接着 `git reset --hard` 作用
在旧库上。同 repo 同 commit 时它碰巧不报错,换个 repo 就是找不到 commit——两种都是坏的。

MemoryBench 里 31 道 eval 是这个 clone 形状,所以整批都卡在这一条上。两条改法:

- **各题自己幂等**:clone 前 `rm -rf .git`。改一行,任何批次组合都能进热道。
- **整批共享一个 checkout**(toggl-cli 该选这条):clone 搬进 `sandbox.setup()` 链。它跑在
  重置点**之前**,checkout 因此成为重置点的一部分——每题的 `git reset --hard` 直接把仓库
  还原成 base commit 的干净状态,一次 clone 都不用重放。

## 2. 与本题无关的安装写在 `EvalDef.setup`:每题都要重放一遍

`harness.ts` 的 `installRustToolchain` 装 apt 依赖、rustup、cargo,再写
`/etc/profile.d/rust.sh` 与各 `$HOME/.cargo/config.toml`。它被 6 道题里的 5 道挂成
`setup: installRustToolchain`——同一个函数、同一份参数,一个字都不随 eval 变。

按分工它属于沙箱层:

```ts
// 之前:每道 eval 各自声明,复用档下每题重放
export default defineEval({ setup: installRustToolchain, async test(t) { … } });

// 之后:整批一次,落在重置点之下
sandbox: e2bSandbox({ template: "…" }).setup(installRustToolchain),
```

这段脚本自带 `if ! command -v cargo` 一类幂等判断,所以留在 eval 层也不会跑坏——重复付的
只是探测开销。真正的理由是分层:**这段准备换一条 eval 还成立吗?成立就不属于 eval 层。**
判据见[环境预置与收尾怎么放](../../experiments/use-case/lifecycle.md)。

再往前一步是烘进 e2b 模板(MemoryBench 已经为 mempal 条件这么做了,见
`scripts/build-mempal-e2b-template.ts`):所有实验都要的重依赖不进任何 `setup`。

## 3. workdir 之外的共享状态:想留的和不想留的都会留

题间重置只作用于 workdir,而且被排除的路径也不清。`installRustToolchain` 写出的东西全在
workdir 之外,所以复用档下它们跨题持久:

| 它写的位置 | 跨题持久意味着 |
|---|---|
| `/opt/cargo-target`(约 1 GB 构建树) | 想要:第二题的 `cargo build --tests` 命中第一题的产物 |
| `/usr/local/{rustup,cargo}`、`/etc/profile.d/rust.sh` | 想要:装一次够整批用 |
| `$HOME/.cargo/config.toml` | 想要:所有 shell 看到同一个 target-dir |

`prepareRepo` 里那次预热构建(`cargo build --tests`,冷跑数分钟)之所以存在,是为了不让
agent 从自己的时间预算里付冷构建。它落在 `/opt/cargo-target`,于是复用档下也只付一次。
把第 1 节的 clone 一起搬到沙箱层之后,这道链的每题固定开销就从「clone + 冷构建」压到
一次 `git reset`。

反过来的例子在 `experiments/shared/mempal.ts`:`mempalSetup` 把宿主机上的记忆状态恢复到
`$HOME/.mempal`,`mempalTeardown` 再打包回宿主机。两个都是沙箱层 Hook,复用档下各跑一次
——一批题共用一份不断累积的记忆库,收尾只存最后那一份。默认档是每 attempt 恢复、每 attempt
回存。对记忆条件来说这不是加速,是换了被测对象,所以那些实验不该带 `--reuse-sandbox` 跑。

## 4. 挂在沙箱层的 teardown 会从「每题一次」变成「整批一次」

`experiments/shared/nowledge.ts` 的 `nowledgeVerifyRemoteAlive()` 挂在沙箱层。
`experiments/compare/claude-dp-v4--nowledge.ts` 里写成 `.teardown(nowledgeVerifyRemoteAlive())`。
它要做的是:attempt 跑完、沙箱销毁前,再探一次这条 attempt 在 setup 时连上的那个隧道 URL。
理由很具体——cloudflare quick tunnel 的地址随进程重连就换,setup 时的探活只证明开跑那一刻
是通的。

默认档下每 attempt 一套沙箱,所以这个探针每题都跑。复用档下沙箱层收尾只在最后一题之后跑
一次,前面每一题都失去了自己的收尾探针:隧道中途挂掉,坏结果会记在挂之前那几题上。

修法是把按 attempt 判定的检查放到按 attempt 执行的层:`EvalDef.teardown` 或 agent 级
teardown 在复用档下仍是每题一次(见[分层表](../serial-reuse.md#复用-sandbox-的题间重置点一次装好后续只重置到这里))。
判据一句话:**这个 teardown 检查的是「这一条 attempt 怎么样」还是「这个环境怎么样」?**
前者不该挂在沙箱层。

## 5. 改完之后

```bash
niceeval exp toggl --reuse-sandbox
```

一次 e2b 沙箱创建、一次 apt + rustup、一次 clone、一次冷构建,之后 6 道题各自
`git reset --hard` 回重置点再重放自己的 fixture。省掉的是 5 次冷启动加 5 次冷构建;
结果照常进 Run 供 `show` / `view` 看,但带 `sandbox.reused` 标记,不进 CI、不进缓存
(见[诚实边界](../serial-reuse.md#诚实边界git-reset-只清-workdir))。

要在 CI 里出可引用的通过率,去掉 flag 用默认档跑。

## 相关阅读

- [串行复用](../serial-reuse.md) —— 重置点的分层、诚实边界、不设检测的裁决。
- [环境预置与收尾怎么放](../../experiments/use-case/lifecycle.md) —— 四层生命周期的分工
  与常见错位。
- [Agent 契约](../../adapters/architecture/agent-contract.md#生命周期不变量) —— agent 级
  setup / teardown 的不变量。
- [本地冒烟一批 eval](reuse-sandbox-batch-smoke.md) —— 改完之后的完整运行路径与反馈形态。
