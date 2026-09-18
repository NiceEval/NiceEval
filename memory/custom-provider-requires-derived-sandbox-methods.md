---
format: concord.document/v1
id: custom-provider-requires-derived-sandbox-methods
title: 自定义 Provider 被要求实现框架生成的 Sandbox 方法
createdAt: 2026-09-05
kind: memory
memoryKind: problem
state: resolved
epoch: 0
promotions: []
history: []
resolution:
  reason: 保留结构化原记录声明的状态；本迁移视图不重新解释。
  at: 2026-09-14T15:00:25.173Z
  epoch: 0
  kind: fixed
  evidenceLevel: attested
  attestation:
    statement: >-
      kind:
        type: problem
        state: resolved
        resolution:
          kind: fixed
          proof:
            - Installed public TypeScript consumer red nered_MJ9T9V3A0QAKYRTK and complete takeover netake_K1ZWVFG8PENNX9RB validate native CustomProviderSandbox input; all 31 Runner cases pass default concurrency and resource cleanup.
            - niceeval.fixed-evidence/v1:{"selectors":["e2e/runner/test/fresh-sandbox-provider-stop.test.ts#necase_9E2KVHJXB3FTA8AE"]}
    proof:
      - Installed public TypeScript consumer red nered_MJ9T9V3A0QAKYRTK and
        complete takeover netake_K1ZWVFG8PENNX9RB validate native
        CustomProviderSandbox input; all 31 Runner cases pass default
        concurrency and resource cleanup.
      - niceeval.fixed-evidence/v1:{"selectors":["e2e/runner/test/fresh-sandbox-provider-stop.test.ts#necase_9E2KVHJXB3FTA8AE"]}
    source:
      path: memory/custom-provider-requires-derived-sandbox-methods.md
      commit: f3d90668c55c74ec7d08e25bf6a0940d0110da1f
      digest: sha256:fc5754d5d582085b2d7411c0ccfbec99aa064f3cb2499a6094eccbbaf9ba71d0
---
公开 `defineSandbox().create` 和 `defineSandboxCase().materialize` 要求完整 `Sandbox`，但 `Sandbox.upload` 消费由框架持有的 opaque `SandboxContent`，`runCommandOrThrow` 与 `runShellOrThrow` 也由 normalization 生成。内部 `SandboxProviderBackend` 已排除 upload，运行时从来不调用作者提供的派生方法，公开作者输入却要求它们。真实 E2E custom Provider 因缺 upload 无法类型检查。

修法应让自定义 Provider 输入只要求原始 I/O 与资源方法，最终 Eval / Agent 的 Sandbox 仍提供全部派生操作；不添加假的 upload stub，也不暴露内容内部表示。由现有 fresh custom Provider stop/recovery Journey 先编译安装后的公开作者输入，再验证同一 Provider 的运行和回收。

安装后公共类型红灯 nered_MJ9T9V3A0QAKYRTK 已复现缺失三个派生方法的 TS2322/TS2739。候选 8888cdca3eac98cb40b59b28af959d7a0161e938cd2b38cc2a9426ebb9953314 的完整接管 netake_K1ZWVFG8PENNX9RB 通过，包含默认并行 31 场景和资源退出核对。
