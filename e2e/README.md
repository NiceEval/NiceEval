# E2E 场景 Repo

正式设计见 [`docs/engineering/testing/e2e/README.md`](../docs/engineering/testing/e2e/README.md)。本目录只说明当前可运行入口；测试契约、owner 与写法不在这里复制。

## 目录

每个带 `e2e.json` 的叶子目录都是一个独立消费项目，自带 `package.json`、lockfile 和原生 Vitest 或 Playwright 测试。根 runner 把候选 `niceeval` tarball 安装进仓库外副本；需要 Testkit 的 Repo 还会从当前 checkout clean-build 私有 workspace package，并只在该副本中注入目录依赖，随后执行 manifest 声明的命令。

```text
e2e/
├── eval/                   # Eval、Context 与公开 Assertion 契约
├── cli/                    # argv、机器输出、失败分类与缓存
├── runner/                 # carry、history 与确定性调度
├── package/                # ESM、CJS、exports 与外部 cwd
├── record/                 # 公开 niceeval/record 写读边界
├── report/                 # show、view、导出与浏览器 Journey
├── lifecycle/              # signal、资源终结与下一消费者
├── adapter/
│   ├── local-protocol/     # 无密钥 transport 与可控故障
│   └── <id>/               # 每个真实 SDK / CLI / provider 一个 live Repo
└── scripts/                # 发现、计划、pack、注入、执行、收据与 artifact
```

目录结构本身不决定测试身份；`e2e.json.id` 才是稳定 Repo id。`adapter/` 只是物理 collection，不提供共享依赖或共享结果根。

功能 Repo 签入自己的 Eval / Experiment，并在每次 invocation 中完整运行生成 `.niceeval` 后再做公开读回；不签入或跨 Repo
复制预生成结果。某个 case 需要另一种 verdict、事件、source 或 Sandbox evidence 时，直接在所属 Repo 增加专用 Eval。

## 根入口

```sh
pnpm e2e plan --lane pr --json
pnpm e2e pack --out /tmp/niceeval-candidate.tgz
pnpm e2e run --candidate /tmp/niceeval-candidate.tgz --repo cli

# 默认模式依次 plan → pack 一次 candidate → 按需 build 一次 Testkit → 运行
pnpm e2e --lane pr
pnpm e2e --repo report -- --run test/report.test.ts
pnpm e2e --repo report -- --run test/report.browser.spec.ts -t "打开"
```

Testkit 没有单独的 tarball 参数。它是同仓库的私有测试工具，不是发布候选；`harness.testkit: true` 是唯一消费声明。runner 会在一次 invocation 中 build 一次 `packages/testkit`，再把该目录作为本地依赖注入隔离副本。场景源 `package.json` 和 lockfile 不声明 Testkit，也不直接链接 workspace。

## 选择与失败

- `plan` 只读 manifest，不 pack、不安装、不读取 secret。
- `run` 在临时副本依次执行 install、injection attestation、test、artifact collection 与 cleanup。
- 选择使用 `--lane`、`--repo`、`--diff-path` 和 capability；不存在旧 `group` 参数。
- 测试非零退出归 regression；安装、注入、artifact 或 cleanup 失败归 infra。Adapter 不用 exit 75 或日志正则猜分类。
- 原始收据、JUnit 与声明的 artifact 写入 durable artifact root；隔离副本在 cleanup 阶段删除。

## 单项调试

正式验收始终走根 runner，确保 candidate 身份和 Testkit 的副本内安装路径可核对。进入叶子目录直接运行 `pnpm e2e` 只适合已经安装好依赖后的测试正文调试；它不证明当前 checkout 的 candidate 已被注入。
