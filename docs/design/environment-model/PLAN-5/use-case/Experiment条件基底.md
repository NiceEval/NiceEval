# C8:Experiment 条件基底

契约单源见 [Library · Experiment 条件基底](../library.md#experiment-条件基底)与 [Architecture · 条件基底](../architecture.md#条件基底与默认-case)。

## 问题

Experiment 有一份预装证书与 mempal 的 E2B template。
Eval 没有不可叠加 Base,只要求 Python 3.12 与指定题目数据。
Runner 应从条件基底创建 Sandbox,再验证并补齐 Eval 条件。

## 声明

```typescript
// eval.ts
export default defineEval({
  environment: defineEvalEnvironment({
    requirements: [
      pythonRuntimeRequirement({ version: "3.12" }),
      taskDatasetRequirement({ digest: DATASET_SHA256 }),
    ],
  }),
  async test(t) {
    await t.send(TASK);
  },
});

// experiment.ts
export default defineExperiment({
  environment: defineExperimentEnvironment({
    requirements: [
      companyCertificates({ bundleDigest: COMPANY_CA_SHA256 }),
      mempalRequirement({
        version: "0.9.0",
        modelDigest: MODEL_SHA256,
      }),
    ],
    base: {
      template: "acme/mempal-runtime-v5",
    },
  }),
  sandbox: e2bSandbox({
    template: "base-node-22",
  }),
  agent: codexAgent(),
});
```

`environment.base` 是条件基底。
`sandbox.template` 是普通默认 case。
因为 Experiment 已经提供条件基底,本条 Attempt 选择 `acme/mempal-runtime-v5`;普通默认 case 不参与冲突。

## 运行路径

1. 规划器发现 Eval 无 Base、Experiment 有条件基底,选择 mempal template。
2. Sandbox ready 后验证四个 Requirement 成员。
3. 证书与 mempal 命中预装时不检查安装能力。
4. Python 或题目数据缺失时,Runner 只为缺失成员执行 Eval Ensure。
5. Eval 与 Experiment 全组验证通过后,AgentProvisioner 执行自己的 Ensure。
6. 最终屏障验证三种所有者,然后 Agent 开始做题。

某个 Eval 成员未命中且没有 install 时,该组合记为运行期不兼容。
结果包含实际检查事实,没有 Agent turn。

## 可观察结果

- configHash 保存实验 Requirement 集合、条件基底、普通默认 case 与 Agent 声明身份。
- fingerprint 保存 Eval 集合、所选条件基底 CaseKey 与逐平台 payload identity。
- 每个成员分别记录初始检查、是否安装、复检、最终检查与耗时。
- `base-node-22` 没有被选中,但它仍作为 SandboxSpec 配置落盘。
