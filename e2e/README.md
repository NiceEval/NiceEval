# E2E 场景 Repo

正式设计见 [`docs/engineering/testing/e2e/README.md`](../docs/engineering/testing/e2e/README.md)。本目录只说明当前可运行入口；测试契约、owner 与写法不在这里复制。

## 目录

每个带 `project.json` 与 `kind:e2e` tag 的叶子目录都是一个独立消费项目，自带 `package.json`、lockfile 和原生 Vitest 或 Playwright 测试。根 runner 把候选 `niceeval` tarball 安装进仓库外副本；需要 Testkit 的 Repo 还会从当前 checkout clean-build 私有 workspace package，需要受信任 harness asset 的 Repo 也只在该副本中获得对应材料，随后执行 `targets.e2e.metadata.niceeval` 声明的命令。

```text
e2e/
├── eval/                   # Eval、Context 与公开 Assertion 契约
├── cli/                    # argv、机器输出、失败分类与缓存
├── runner/                 # carry、history 与确定性调度
├── package/                # ESM、CJS、exports 与外部 cwd
├── inspection/             # fixed query、show 与终端 Inspection
├── insight/                # view 与浏览器 Insight Journey
├── lifecycle/              # signal、资源终结与下一消费者
├── record/                 # 公开 Record API、bounded streaming、publication 与 Snapshot
├── migrate/                # 已声明 predecessor 的 migration 与数据发布原子性
└── adapter/
    ├── local-protocol/     # 无密钥 transport 与可控故障
    └── <id>/               # 每个真实 SDK / CLI / provider 一个 live Repo
```

Host-side 的发现、计划、pack、注入、执行、收据与 artifact 编排位于独立的私有 workspace package
`packages/e2e-runner/`；`e2e/` 只保存场景 Repo 与本入口说明。

`project.json.root` 是 E2E identity 的唯一真源；canonical Repo id 从 `e2e/` 后的 leaf root 推导。`adapter/` 只是物理 collection，不提供共享依赖或共享结果根。

功能 Repo 签入自己的 Eval / Experiment，并在每次 invocation 中完整运行生成 `.niceeval` 后再做公开读回；不签入或跨 Repo
复制预生成结果。某个 case 需要另一种 verdict、事件、source 或 Sandbox evidence 时，直接在所属 Repo 增加专用 Eval。

## 根入口

```sh
pnpm --silent e2e plan --lane pr --json
pnpm --silent e2e plan --lane release --no-diff --json
pnpm e2e pack --out /tmp/niceeval-candidate.tgz
pnpm e2e run --candidate /tmp/niceeval-candidate.tgz --repo cli
pnpm e2e run --candidate /tmp/niceeval-candidate.tgz \
  --plan /tmp/e2e-plan.json --cell repo-batch-docker-1
pnpm e2e run --candidate /tmp/niceeval-candidate.tgz --repo inspection \
  --artifact-root /tmp/e2e-artifacts --keep-workdir
pnpm e2e diagnose test --from /tmp/e2e-artifacts/summary.json --repo inspection \
  --timeout-seconds 15 -- --run test/inspection-query.test.ts -t "打开"
pnpm e2e diagnose exec --from /tmp/e2e-artifacts/summary.json --repo inspection \
  --timeout-seconds 15 -- pnpm exec niceeval query discover
pnpm e2e takeover --candidate /tmp/niceeval-candidate.tgz --repo insight \
  -- --run test/view-snapshot.browser.spec.ts -t "读者"
pnpm e2e verify-release --plan /tmp/release-plan.json --candidate /tmp/niceeval-candidate.tgz \
  --receipt-root /tmp/release-receipts --tag v0.4.6

# 默认模式依次 plan → pack 一次 candidate → 按需 build 一次 Testkit → 运行
pnpm e2e test --lane pr
pnpm e2e test --lane main
pnpm e2e test --repo inspection -- --run test/inspection-query.test.ts
pnpm e2e test --repo insight -- --run test/view-snapshot.browser.spec.ts -t "读者"
```

Testkit 没有单独的 tarball 参数。它是同仓库的私有测试工具，不是发布候选；`harness.testkit: true` 是唯一消费声明。runner 会在一次 invocation 中 build 一次 `packages/testkit`，再把该目录作为本地依赖注入隔离副本。场景源 `package.json` 和 lockfile 不声明 Testkit，也不直接链接 workspace。

## 选择与失败

- `plan` 只读 manifest，不 pack、不安装、不读取 secret。
- `run` 在临时副本依次执行 capability preflight、install、injection attestation、browser preflight、test、artifact collection 与 cleanup。
- `diagnose test/exec` 只在本地消费正式 `--keep-workdir` summary：前者复用 retained Repo 跑原生文件 / 标题，后者在短命新副本跑一条公开命令；两者都不重新 pack / install，也不产生正式 E2E pass。
- 选择使用 `--lane`、`--repo`、`--diff-path`、`--no-diff` 和 capability；不存在旧 `group` 参数。PR CI 传入已验证的 base 与实际 checkout HEAD，main、nightly、release 和显式 full 才传 `--no-diff`。
- 显式 `--repo` 不受 `--diff-path` 过滤；candidate 的 `packages/niceeval/bin/`、`packages/niceeval/dist/`、package-runtime/reference/docs 输入、root pack 配置或共享 runner 改动会 fail-open 选择整条 lane。
- 默认入口只生成一次 plan；run 只接收该 plan 的精确 Repo ID 集。local diff 同时含 tracked 与未忽略 untracked 路径。
- 测试非零退出归 regression；安装、注入、artifact 或 cleanup 失败归 infra；缺 runtime、Docker daemon、browser 或 declared secret 归 configuration；根 signal 归 cancelled。Adapter 不用 exit 75 或日志正则猜分类。
- 原始收据、JUnit 与声明的 artifact 写入 durable artifact root；隔离副本在 cleanup 阶段删除。
- durable root 先物理锚定；root 自身及以下的 candidate、receipt 与 summary 目录链逐段核验。内部 symlink 使 runner 以 infra 结束。

根 CLI 只管理它创建的 detached process group：SIGINT/SIGTERM 第一次先停止新阶段并转发同 signal，grace 后 KILL，等待 `close` 后再检查 group 是否还有可运行成员；第二次立即 KILL。Linux `/proc` 若证明只剩不可运行的 zombie，收据明确记录主机 init 尚未 reap，不把它误报成仍在运行的泄漏。每个 command capture 的 `groupCleanup` 都写入探测、信号和终态。场景自己的 container、server、Sandbox 或新 session 仍由场景 receipt 负责。每个原生 test command 获得新 `NICEEVAL_E2E_INVOCATION_ID`，不含 secret。

子进程保留 PATH、locale 和 Node/pnpm 等普通变量。未由当前 Repo 声明的 token、key、secret、password、credential、auth、jwt 与数据库连接变量会被剥离。preflight、install 和 test 共用这项策略，receipt 不写值。

`takeover` 固定一次 candidate、checkout/source snapshot 与按需 Testkit build，留下三个隔离副本、一个同已安装副本连续两次、Repo 默认并行和目标单项的 receipt；它不是 retry。summary 带 source snapshot 的 SHA-256 文件清单，所有 receipt 绑定该 digest，并核验矩阵结构与 cleanup。`verify-release` 只在本地验证非空 plan、receipt 精确集/全 pass、candidate 与保留 tarball digest，以及 package/tag 身份，不发布。保留 tarball 的 root 内祖先 symlink 会被拒绝。

## 单项调试

快速交付中，一个 candidate 只准备一次。完整本地 E2E 只承担首次公开红灯、候选定点转绿、必要 takeover 与最终收据；CI / 线上负责最终完整矩阵，不承担逐步调试。首次完整运行预计需要定位时，在根参数的 `--` 前加 `--keep-workdir`，从终态 summary 取得 retained 场景：

```sh
pnpm e2e diagnose test --from <summary.json> --repo <id> [--timeout-seconds 15] -- <native target args>
pnpm e2e diagnose exec --from <summary.json> --repo <id> [--timeout-seconds 15] -- <argv>
```

`test` 在 retained Repo 的同一 installed candidate / Testkit 上快速收窄单文件或标题；`exec` 克隆短命副本执行一条公开命令。每次尝试都有新 invocation、独立 diagnostic receipt、同一环境敏感变量过滤与 owned process-group cleanup。默认短 timeout 用来尽快证伪定位假设，不等待 Repo 完整 timeout。

diagnostic 绿色不是正式 E2E pass，也不能替代 candidate 转绿或 takeover 收据。candidate 变化后旧现场不可复用，必须重新 pack / install 并通过新的正式运行保留现场。正式验收始终走根 runner；进入叶子目录直接运行 `pnpm e2e` 只适合测试正文调试，不能证明当前 checkout candidate 的注入身份。
