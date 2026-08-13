# Plugin 的 Run／Attempt binding

Plugin mount 是条件蓝图，不是 writer 或 DI container。它只在 owner fragment 中贡献 opaque binding declarations：

```ts
export const candidateRuntime = definePlugin<CandidateOptions>({
  name: "com.example.candidate-runtime",
  behaviorRevision: "3",

  experiment(options) {
    return {
      recordAdapters: {
        run: [candidateRuntimeRunBinding(options)],
        attempt: [candidateRuntimeAttemptBinding(options)],
      },
    };
  },
});
```

link 把它拆成两个 occurrence：

```text
shared Plugin mount provenance
  ├─ Run occurrence
  │    └─ run bindings / Run identity / Run Scope
  └─ pair/Attempt occurrence
       └─ attempt bindings / pair identity / Attempt Scope
```

两边按 `(owner, name)` 独立排除重复，各自建立 total obligation，并只把成功 accepted event 写入对应 provenance entry。
Experiment Hosted Hooks 仍属于 Attempt occurrence；setup／teardown 属于 Run occurrence。

Hosted Hook context 只读暴露身份、exit、signal 与 diagnostic，不暴露 adapter、installation 或 command。Group 没有 Run 或
Attempt owner，因此不能贡献 `recordAdapters`。

Plugin package 可另导出 installation 供 application host 显式安装；mount 本身不自动安装。这样 producer 被删除后，
历史读取与 migration 仍可保留。
