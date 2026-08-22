# 任务图与 E2E 选择

本主题定义 niceeval 仓库如何用 Nx 管理项目图、任务输入和受影响的 E2E 集合。它只负责回答“这次变更需要验证哪些项目”；
候选包、Testkit、真实场景、收据和资源回收仍由 NiceEval 根 E2E runner 拥有。

目标是同时得到三种可审计结果：

- `apps/site/**` 与内部 `docs/**` 变更不运行产品 E2E；
- 产品域或单个场景 Repo 变更只运行图上受影响的 E2E；
- 无法安全归类的源码、共享测试设施或选择器故障扩大为该 lane 全量，不能绿色少跑。

Nx 版本精确锁定为 `23.1.1`。升级不是普通依赖刷新；必须重新执行本页的选择收据、直接执行护栏和完整无密钥 lane。

## 职责边界

```text
Git diff / local dirty paths
        │
        ▼
Nx project graph ── affected E2E project IDs
        │
        ▼
NiceEval planner ── lane / trust / capability / batch cells
        │
        ▼
NiceEval runner ── candidate / Testkit / native tests / receipts / cleanup
```

| 机制 | 唯一职责 | 不负责 |
|---|---|---|
| `project.json` | project 身份、E2E target metadata、图依赖和项目级输入 | pack、读取 secret、启动测试或收 artifact |
| `nx.json` | workspace 级 named inputs、target defaults 与插件版本行为 | 产品 owner 断言或 CI lane 政策 |
| `pnpm e2e plan` | 校验 changed paths、读取 Nx affected、应用 lane 并产出可执行 cells | 执行场景 |
| `pnpm e2e` / `run` | 一次候选、一次 Testkit snapshot、真实场景与完整生命周期 | 重新推导 affected 集合 |
| GitHub Actions | checkout、传递 base/head、分发 cells、cache 与上传 artifact | 维护第二份 Repo、path 或 owner 清单 |

`targets.e2e` 是选择标记，不是可独立运行的任务。它只带 Nx 找不到的
`executor: "nx:selection-only"` 哨兵，没有真实 command；维护者用
`nx show projects --affected --with-target e2e` 查看选择，但不能用 `nx affected -t e2e` 绕过根 runner。
直接执行后者必须因哨兵 executor 不存在而在 pack、secret 注入、场景子进程和 artifact 创建前明确失败。正式执行入口始终是
`pnpm e2e`。

## Workspace 目录管理

`apps/` 放可部署应用，`packages/` 放供其它项目复用或发布的库。当前布局是：

```text
apps/
├── site/       # Landing Page，独立部署，不拥有产品 E2E
└── docs-site/  # Mintlify 文档站，其中中文正文与图片会进入 niceeval tarball
packages/
├── niceeval/    # 发布包
├── testkit/     # 私有、guest-side E2E harness
└── e2e-runner/  # 私有、host-side E2E 编排器
```

目录位置只表达所有权，不直接决定 affected 结果。`apps/site` 用 `e2e:none` 表达合法空计划；
`apps/docs-site` 保留 `kind:packaged-docs`，Package E2E 通过 project dependency 拥有它。依赖方向是 app → package，
产品 E2E 不反向依赖 app。

新增或移动 app 时，同一次变更必须更新 app 自己的 `project.json`、`pnpm-workspace.yaml`、根脚本、部署输出目录和引用该源码的 lint／生成器。
Project name 是图上的稳定 identity，不因物理目录移动而重命名。若 app 内容进入发布包，staging 源路径使用 `apps/**`，tarball 内公开路径保持 package 契约，不把仓库布局泄漏给消费者。

## Project 形状

### 场景 Repo

每个 `e2e/<id>/` 叶子都包含 `package.json`、签入 lockfile 和一个 `project.json`。嵌套 adapter 的 canonical ID 仍由
相对根目录推导，例如 `e2e/adapter/ai-sdk` 对应 `adapter/ai-sdk`；配置不能另写一份可漂移的 ID。

```json
{
  "name": "e2e-report",
  "root": "e2e/report",
  "tags": ["kind:e2e"],
  "implicitDependencies": [
    "niceeval-src-fallback",
    "niceeval-domain-report",
    "niceeval-domain-record"
  ],
  "targets": {
    "e2e": {
      "executor": "nx:selection-only",
      "cache": false,
      "metadata": {
        "niceeval": {
          "schemaVersion": 3,
          "batch": "browser-1",
          "areas": ["report"],
          "lanes": ["pr", "main", "nightly", "release"],
          "executor": { "kind": "host" },
          "command": ["pnpm", "exec", "vitest", "run"],
          "timeoutMinutes": 2,
          "harness": { "testkit": true },
          "secrets": [],
          "requires": { "browsers": ["chromium"] },
          "artifacts": ["test-results/**", "playwright-report/**"]
        }
      }
    }
  }
}
```

`project.json` 是场景编排的唯一真源，不再并存 `e2e.json`。`metadata.niceeval` 只保存执行所需领域信息；affected
关系由 project graph 表达，不在 metadata 中复制 `paths`。存在场景 `package.json` 却缺 `project.json`、root 与目录不一致、
metadata 非法或重复 name 时，discovery 聚合报错并进入 `invalid`，不能忽略该叶子。

### 产品源码

`packages/niceeval/src` 本身是 `niceeval-src-fallback` project；已归域的一层目录在它下面形成嵌套 project。
例如，`packages/niceeval/src/record/project.json` 是 `niceeval-domain-record`。Nx 按最长 project root 把文件归给细分域，剩余的
顶层文件、新目录和未归域源码仍属于 fallback。

所有 E2E project 都依赖 fallback。这样新增源码不会因忘记登记 owner 而漏跑；同时 E2E 不依赖整个 `niceeval` package project，
避免任一已归域源码变化都扩成全量。

以下跨域最小 owner 是安全边界，不能仅凭静态 import 缩减：

| 源码域 | 至少受影响的 E2E |
|---|---|
| `record/**` | `eval`、`migrate`、`report`、`runner` |
| `sources/**` | `eval`、`runner`、`report` |
| `o11y/**` | 全部 adapter Repo、`eval`、`lifecycle`、`runner`、`report`、`migrate` |
| `agents/**` | 全部 adapter Repo、`eval`、`lifecycle`、`runner` |

其它域也由 E2E project 对对应 `niceeval-domain-*` 的依赖表达。若一个产品行为跨域，应该给真正拥有该用户结果的 E2E
增加图依赖；不能在 planner 里补一张 owner 表。要缩减上述边界，必须先用安装后 candidate 做能杀死错误映射的红灯 / 绿灯
mutation 收据。

### 明确不拥有产品 E2E 的项目与路径

`apps/site` 和内部 `docs` project 带 `e2e:none` tag。合法空计划只在所有 changed paths 都由这类 project 解释时成立。
`apps/docs-site` 不带该 tag：中文随包文档和图片进入 candidate，因此它至少影响 Package E2E。

不属于任何产品、candidate、Testkit 或根 E2E runner 的仓库维护面统一写进根 `.nxignore`。
它是“不触发产品 E2E”的集中黑名单，不是 E2E 输入白名单。以下内容可以整类排除：

- agent / editor 配置和 friction log；
- 历史材料、独立示例和静态 README 素材；
- 由其它 workflow 或 suite 验收的部署与宿主镜像文件。

任何未明确排除的新路径仍落入 workspace shared input，并 fail-open 为当前 lane 全量。
planner 用 Nx 同一套 `.gitignore` + `.nxignore` 语义交叉校验 changed paths，不能在 workflow 或 planner 里再复制 glob 表。
修改 `.nxignore` 自身会触发全量，分类边界的变化必须先经过完整无密钥 lane。

共享输入不建伪产品域。Testkit、`packages/e2e-runner/**`、package root / runtime builder、lockfile、workspace / Nx 配置以及
E2E workflow 的变化属于所有 `e2e` target 的 workspace inputs，必须产生当前 lane 全量。单个 `e2e/<id>/**` 仍只影响该叶子；
多个叶子同时变化时取并集，只有共享 runner、选择器、注入或 receipt 设施变化才扩为全量。

## Changed path 完整性

CI 必须比较已验证为 checkout ancestor 的 base 与实际 checkout HEAD，不能比较事件载荷里一个未检出的假想 SHA。
rename 按 delete 与 add 两条路径处理。选择收据保存最终 base/head。

本地默认 dirty 集合同时包含：

- 相对 `HEAD` 的 staged 与 unstaged 修改；
- tracked 删除；
- 未被 Git 忽略的 untracked 文件。

每条路径都必须得到以下一种解释：

1. 归属于会传播到 E2E 的 project；
2. 归属于 `e2e:none` project；
3. 被根 `.nxignore` 明确归类为不影响产品 E2E；
4. 落入源码 fallback 或共享 full input。

路径存在但 Nx 没有归属、Nx 输出不可解码、base/head 无效或选择命令失败时，planner 进入 `fail-open-full`。它不能把“没有
选出项目”当成合法空计划。

## 四种计划状态

计划 artifact、job summary 和每个 cell 收据都保留同一个 `mode` 与 `reason`：

| mode | 含义 | 是否可成功 |
|---|---|---|
| `invalid` | project、metadata、参数或信任输入非法 | 否；在 pack、secret 和任何场景副作用前退出 |
| `affected` | Nx 成功解释全部路径，或维护者用 `--repo` 给出精确集合 | 是；`e2e:none` 变更允许 cells 为空 |
| `full` | main、nightly、release 或显式 `--no-diff` 要求正常全量 | 只有当前 lane 全部 cells 真正运行并通过后才可成功 |
| `fail-open-full` | diff 或 Nx 选择不可安全完成 | 只有当前 lane 全部 cells 真正运行并通过后才可成功 |

`fail-open-full` 不是日志警告或绿色 fallback。planner 必须产出 lane 全集，并把具体故障写入 `reason`；workflow 随后按完整
matrix 执行。secret 只在合法计划已产生且最终 cell 非空时按 Repo 白名单注入。
分布式 `run --plan --cell` 会把同一份 `mode`、`reason`、`lane`、cell ID 与可选 base/head 写进根 summary 和每个 Repo
receipt；artifact 离开 Actions 后仍能说明该 Repo 为什么被选择。

以下运行模式不经过 affected 缩减：main push、nightly、release 验收、显式 `--no-diff` / full dispatch。PR 使用 affected：
同仓可信 PR 在选中 live owner 时使用 main lane 和最小 secret 白名单，Fork / Dependabot 使用无密钥 pr lane。

## 管理操作

### 新增或修改 E2E Repo

1. 从 [测试组合](../testing/portfolio.md) 确认唯一长期结果 owner，再按
   [真实场景 Repo](../testing/e2e/scenario-repos.md) 创建叶子。
2. 在叶子 `project.json` 配置 `kind:e2e`、`executor: "nx:selection-only"` 哨兵与严格 `metadata.niceeval`；真实命令只放在 metadata，由根 runner 执行。
3. 把产品输入建模成对 `niceeval-domain-*` 的依赖；不增加 `paths`，不在 workflow 或 planner 复制 Repo ID。
4. 用 `pnpm --silent e2e plan --repo <id> --lane pr --json` 校验 manifest，再用一个真实安装后场景验收执行生命周期。
5. 修改 source owner 时，同时保存目标域、fallback、单叶子和无关域的 affected 收据。

### 新增或移动产品源码域

1. 新目录默认先由 `niceeval-src-fallback` 接管，因此迁移提交先得到 full plan。
2. 只有边界和 E2E owner 已明确时，才在该目录增加 domain `project.json`。
3. 给所有真实 owner E2E 增加依赖，并检查反向 affected 集；不得为了缩短 CI 只照抄静态 import graph。
4. 证明域内代表文件只命中 owner，同时顶层、新目录和未归域文件仍命中 lane 全集。

### 修改共享编排设施

Nx 版本、`nx.json`、planner、Testkit、candidate 打包 / 注入、receipt、cleanup 或 E2E workflow 变化都按 full 处理。
变更必须证明 graph-only 无副作用、直接 Nx task 早失败、`pnpm e2e` 仍只 plan 一次、pack 一次并构建一次 Testkit snapshot。

## 验收收据

每次升级 Nx、修改图边界或改变 planner 时，固定保存以下选择结果的 exact project IDs、matrix cells、`mode`、`reason`、
base/head 和 Nx graph JSON：

| 变更样本 | 预期 |
|---|---|
| `apps/site/**`、`docs/**` | `affected`，零产品 E2E |
| `.agents/**`、`memory/**` 等 `.nxignore` 路径 | `affected`，零产品 E2E |
| `apps/docs-site/zh/**` | 只选 Package owner |
| `record/**` | `eval`、`migrate`、`report`、`runner` |
| 单个 `e2e/<id>/**` | 只选该 Repo |
| Testkit、E2E runner、package root、E2E workflow | 当前 lane 全量 |
| 顶层、新目录、未归域产品源码 | fallback，当前 lane 全量 |
| 非法 project metadata | `invalid`，零副作用红灯 |
| 坏 SHA 或 Nx 选择失败 | `fail-open-full`，完整执行而非空计划 |
| 显式 full | 当前 lane 全量 |

除了选择收据，还要实际运行一个无密钥 affected 集和完整无密钥 PR lane。图命令前后检查 candidate、artifact 与场景进程均
没有出现；直接 `nx affected -t e2e` 必须非零。迁移或升级自身因修改共享输入而应得到 full plan。

出现误选时先用 `nx graph`、`nx show project <name>` 与 affected JSON 查清 project 归属和依赖边，再修改唯一图真源。
不在 workflow 增加 path filter 止血。回滚以一次 Git revert 恢复整个迁移提交；不保留旧 manifest reader 或双写过渡层。
