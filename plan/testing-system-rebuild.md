# 正式测试体系实现 TODO

本树直接表达依赖关系，不按阶段组织。`depends on` 未完成的节点不得宣称验收完成；标为 `parallel with` 的节点可由不同 worker 同时修改不重叠路径。

```text
[x] T0 关闭 Testkit 与发布契约（串行根节点）
├─ [x] T0.1 在 docs/engineering/testing/testkit.md 定义仓库身份
│      owner: docs/engineering/testing/testkit.md
│      decision: packages/testkit；自带 pnpm-workspace.yaml/lockfile，不是根 workspace member；包名 @niceeval/testkit；独立 semver
├─ [x] T0.2 定义独立发布身份
│      owner: docs/engineering/testing/testkit.md, AGENTS.md
│      decision: testkit-vX.Y.Z tag + 独立 workflow；产品 vX.Y.Z 不发布 Testkit
├─ [x] T0.3 定义 bootstrap
│      owner: docs/engineering/testing/testkit.md
│      decision: meta-test 后只 pack 一次；pilot 与 publish 消费同一字节；产品 gate 必须锁定 registry 已发布版本
├─ [x] T0.4 固定结果观察白名单与重构预算
│      owner: docs/engineering/testing/{architecture,portfolio}.md
│      layers: harness attestation / outcome oracle / diagnostic only
│      allow: 安装包公开 API、CLI exit/stdout/stderr、公开 JSON、Record API、HTTP、实际 href、可访问身份、视觉结果
│      deny: src、私有 .niceeval 布局、内部 DTO/类型、函数/调用顺序、hydration 全局量、DOM class、candidate 派生 expected
│      budget: 内部机制或无关 DTO 变化不得修改 E2E；公开结果契约变化才修改对应 owner
├─ [x] T0.5 固定 Record 与 Report 的 owner 边界
│      owner: docs/engineering/testing/e2e/{record,report}.md
│      decision: e2e/record 独占公开 Record API/格式；Report 不读私有文件布局
├─ [x] T0.6 固定可证伪的重构免疫验收
│      owner: docs/engineering/testing/{architecture,portfolio}.md
│      acceptance: Report/Runner/Record 各做一次 contract-preserving perturbation，测试源码/fixture/expected 零 diff
└─ [x] T0.7 通过 design_grill
       acceptance: Sol PASS；CONDITIONAL 的 C1–C8 已逐条满足并复审

[x] T1 建立 @niceeval/testkit 包（depends on T0；parallel with T2）
├─ [x] T1.1 建 package、exports、tsconfig、独立 lockfile 与 README
│      owner: packages/testkit/**（含 package-local pnpm-workspace.yaml；不改根 workspace）
├─ [x] T1.2 实现 argv、command、runProcess 与完整 ProcessReceipt
│      owner: packages/testkit/src/process.ts
├─ [x] T1.3 实现 startProcess、withProcess、signal/dispose 与 cleanup 错误组合
│      owner: packages/testkit/src/process-lifecycle.ts
├─ [x] T1.4 实现 json/ndjson、only、defined、wait/poll 与临时目录
│      owner: packages/testkit/src/{process,process-lifecycle,primitives,temp}.ts
├─ [x] T1.5 实现 withProjectCopy 与 withHttpServer
│      owner: packages/testkit/src/{project-copy,http-server}.ts
├─ [x] T1.6 用非 NiceEval fixture 完成 meta-tests
│      owner: packages/testkit/test/**
└─ [x] T1.7 验收候选包内容
       acceptance: test/pack 全绿；仓库外 ESM/CJS consumer 在 Node >=18 导入成功；根 lockfile 零 diff

[x] T2 重构根 E2E runner（depends on T0；parallel with T1）
├─ [x] T2.1 用正式 schema 替换 group manifest
│      owner: e2e/scripts/manifest.ts, e2e/scripts/discovery.ts
│      contract: schemaVersion/id/areas/lanes/executor/command/timeoutMinutes/secrets/requires/paths/artifacts
├─ [x] T2.2 拆出 pack 命令并保留 tarball digest/identity
│      owner: e2e/scripts/pack.ts, e2e/scripts/injection.ts
├─ [x] T2.3 实现 plan 的 lane/repo/path/capability 选择与 JSON 输出
│      owner: e2e/scripts/plan.ts
├─ [x] T2.4 实现 run 的 isolate/install/test/collect/cleanup/summary
│      owner: e2e/scripts/run-repo.ts, e2e/scripts/receipt.ts, e2e/scripts/artifacts.ts
├─ [x] T2.5 让入口支持 pack、plan、run；无子命令等价 plan → pack → run
│      owner: e2e/scripts/e2e.ts, package.json
├─ [x] T2.6 删除 --group 与 exit 75 猜测式 infra 兼容
│      owner: e2e/scripts/run.ts, e2e/scripts/list.ts
├─ [x] T2.7 为 schema、选择、注入、artifact、cleanup 和分类写 Unit
│      owner: test/unit/e2e-runner/**
└─ [x] T2.8 验收纯计划不 pack、不安装、不读 secret
       acceptance: pnpm e2e plan --lane pr --json

[x] T2A 建立测试私有依赖机器守护（depends on T0.4；parallel with T1/T2）
├─ [x] T2A.1 扫描结果层测试，拒绝 root src、候选内部子路径与生产类型 import
├─ [x] T2A.2 拒绝私有 .niceeval 路径、hydration 全局量、template ID、DOM class 与拼接 attempt 路径作为 oracle
├─ [x] T2A.3 扫描场景依赖，拒绝 Testkit 的 workspace/file/tarball/Git/latest/版本范围
└─ [x] T2A.4 把守护放入 test/docs 或 test/unit，复用现有命令

[ ] T3 建立 Testkit 发布链（depends on T1；parallel with T2.3–T2.8）
├─ [x] T3.1 新增 testkit-v* tag workflow
│      owner: .github/workflows/release-testkit.yml
├─ [x] T3.2 workflow 只在 packages/testkit 内 install/typecheck/test/pack/publish
├─ [x] T3.3 发布后核对 npm version、tarball integrity 与 provenance
└─ [ ] T3.4 首次发布 @niceeval/testkit，并记录精确版本
       acceptance: npm view @niceeval/testkit@<version> version

[ ] T4 迁移 CLI 确定性 pilot（depends on T1.6, T2.5；最终 gate depends on T3.4）
├─ [x] T4.1 把 e2e/cli/e2e.json 改为 pr lane 的正式 manifest
│      owner: e2e/cli/e2e.json
├─ [x] T4.2 用签入确定性 Agent/backend 替换真实模型与 secret
│      owner: e2e/cli/agents/**, e2e/cli/src/**, e2e/cli/experiments/**,
│             e2e/cli/evals/**, e2e/cli/{niceeval.config.ts,e2e.json,package.json,pnpm-lock.yaml,scripts/e2e.ts}
├─ [x] T4.3 改成原生 Vitest 文件并使用 @niceeval/testkit
│      owner: e2e/cli/test/**, e2e/cli/package.json, e2e/cli/vitest.config.ts
├─ [x] T4.4 只保留一个垂直命题
│      proof: 外部副本安装同一 candidate → 执行公开 CLI → 严格读回结果
├─ [x] T4.5 做重构免疫审查
│      acceptance: 测试不 import candidate 类型或源码，不读取私有结果布局，不断言内部调用与当前 DTO
├─ [x] T4.6 注入 selector 忽略、failed/errored 交换、NDJSON 截断三类错误并确认 pilot 红在公开阶段
├─ [x] T4.7 删除被替代 scripts/e2e.ts、scripts/verify.ts 与真实模型配置
└─ [x] T4.8 验收 Repo、文件、标题三种重跑
       acceptance: pnpm e2e --repo cli -- --run test/<pilot>.test.ts -t <title>

[x] T5 改造 GitHub E2E 编排（depends on T2.3；parallel with T4）
├─ [x] T5.1 package job 只生成一次 niceeval candidate 与 sha256
├─ [x] T5.2 plan job 产出正式 matrix
├─ [x] T5.3 matrix job 下载同一 tarball并调用 e2e run
├─ [x] T5.4 aggregate job 汇总 JUnit、receipt 与 artifact
├─ [x] T5.5 PR 无 secret；main/nightly/release 使用对应 Environment
└─ [x] T5.6 workflow 不再解释 group、Repo expected 或重试
       owner: .github/workflows/e2e.yml

[ ] T6 迁移其余场景 Repo（depends on T4 pilot；各叶子互相 parallel）
├─ [ ] T6.1 runner：carry/history 与确定性调度证据
│      owner: e2e/runner/**
├─ [ ] T6.2 package：CJS/ESM/exports/外部 cwd
│      owner: e2e/package/**
│      blocked: candidate exports 指向 node_modules 内 TS 源文件，Node 24 的真实 ESM/CJS 消费均报 ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
├─ [x] T6.3 report：确定性 evidence + Playwright
│      owner: e2e/report/**
├─ [x] T6.4 record：公开 Record API/格式；不拥有私有存储布局
│      owner: e2e/record/**
├─ [ ] T6.5 lifecycle：signal/cleanup/下一消费者
│      owner: e2e/lifecycle/**
├─ [x] T6.6 adapter/local-protocol：PR transport/fault
│      owner: e2e/adapter/local-protocol/**
└─ [x] T6.7 live adapters：每个 adapter/<id> 独立迁移，彼此 parallel
   ├─ [x] T6.7.1 ai-sdk
   ├─ [x] T6.7.2 codex-cli
   ├─ [x] T6.7.3 claude-code
   ├─ [x] T6.7.4 bub
   ├─ [x] T6.7.5 hermes
   ├─ [x] T6.7.6 openclaw
   └─ [x] T6.7.7 opencode
          owner: e2e/adapter/<id>/**

[ ] T7 删除旧体系（depends on 每个新 owner 接管；可随对应 T4/T6 节点串行收尾）
├─ [ ] T7.1 每个新 owner 接管时同批删除线性 scripts、group 字段、共享真实模型 fixture 或私有 oracle
├─ [ ] T7.2 重写 e2e/README.md，使其只描述当前已落地入口
├─ [ ] T7.3 更新 lockfile、源码注释、AGENTS 与链接
├─ [ ] T7.4 pnpm test、pnpm test:docs、pnpm run typecheck
└─ [ ] T7.5 pr lane 全绿；main/nightly 未选择项在 plan 中可见而非伪装 pass
```

## 当前并行占用

| 执行线 | 首个写入范围 | 串行依赖 | 可并行对象 |
|---|---|---|---|
| Testkit | `packages/testkit/**` | T0 | Runner |
| Runner | `e2e/scripts/**`, `test/unit/e2e-runner/**` | T0 | Testkit |
| CLI pilot | `e2e/cli/**` | T1.6 + T2.5 | Workflow（进入等待前） |
| Workflow | `.github/workflows/e2e.yml` | T2.3 | CLI pilot |

父 agent 只在依赖满足后勾选节点；worker 的 `done` 不等于节点完成，必须核对 diff、运行该节点 acceptance 并确认没有带入其它路径。
