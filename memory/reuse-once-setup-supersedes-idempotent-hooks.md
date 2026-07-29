# 设计裁决:沙箱复用定稿为串行复用(温基线一次装好),推翻「每 attempt 重跑幂等钩子」

## 裁决

2026-07-21,roadmap「串行复用沙箱」定稿搬入 `docs/feature/sandbox/serial-reuse.md`:`--reuse-sandbox` 让整批同基线 eval 共用一个热沙箱串行跑,不随 eval 变的层(`createSandbox`、`sandbox.setup` 链、`SandboxAgent.setup`)整组只执行一次、落成温基线 commit,题间只 `git reset --hard 温基线` + 尊重分类账排除清单的 `git clean`,每题只重放 `EvalDef.setup` / `test(t)` 夹具。入口是短暂 CLI flag,不进 experiment 配置;与 `--keep-sandbox`、`localSandbox()`、异构批次组合都在创建前报错;复用结果打 `reuse` 标记不进跨 run 缓存。

## 曾选方案与否决理由

- **复用沙箱每个 attempt 仍走一遍 `sandbox.setup` 链,钩子必须幂等**(runner.md 旧「跨 case 复用」声明):否决——复用的全部动机是把与本题无关的安装移出关键路径,每题重跑 setup 链省不掉大头;「幂等」还给每个钩子作者压了一条隐性义务。定稿改为按「随不随 eval 变」切层,不变层一次、可变层重放,不需要幂等假设。
- **复用作为可开关的运行配置(可签入)**:否决——`git reset` 只清 workdir(分类账跟踪部分),`$HOME`/全局包/进程/被排除路径一律持久,复用可能改变判定结果 → 不可复现 → 只能是短暂 flag,CI 与跨 run 缓存都不采信。
- **localSandbox 上的复用加安全前置(干净工作树 / 隔离 worktree)**(local.md 曾悬置给提案裁决):否决——本地档没有冷启动可省,复用无收益;且题间 reset 与本地档「绝不动用户没提交的工作」直接冲突。定稿为组合在创建前报错。

## 落点

新增 `docs/feature/sandbox/serial-reuse.md`;改写 `docs/runner.md` 预热与复用小节、`docs/feature/sandbox/architecture.md` 性能小节、`cli.md` keep/reuse 互斥条目、`local.md` 两处;场景行登记在 `docs/engineering/testing/unit/sandbox.md` 串行复用分区。

## 后续翻案:入口从 CLI flag 改成实验字段

本条的「入口是短暂 CLI flag(`--reuse-sandbox`),不进 experiment 配置」这一半已被推翻。
定稿形态是实验字段 `sandboxReuse: true`(契约在 `docs/feature/sandbox/reuse.md`,
`serial-reuse.md` 已并入它):复用是可签入的实验语义,进 `configHash`,同一个 experiment
不能由 CLI 临时开关;要全新 Sandbox 的对照就另写一个不声明它的 experiment。
「与结果沿用双向绝缘」「与 keep / local 互斥」「按 environment profile 分组」三条仍然成立,
只是异构批次不再报错——Runner 分组后各组各复用。

本条按 CLI flag 写的那一版在 `docs-site/zh` 里留了整整一页教程没跟着改,
见 [docs-site-lagged-behind-two-renames](docs-site-lagged-behind-two-renames.md)。
