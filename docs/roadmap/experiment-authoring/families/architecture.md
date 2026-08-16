# 具名 Experiment 族 —— Architecture

## Discovery

Runner 导入一个 Experiment 文件后，先按私有品牌判别 single definition 或 family definition。
family record 在任何 Provider I/O 前完成 key 验证与成员配置求值。
成员按规范 key 顺序展开，不依赖 JavaScript property 插入顺序。

每个成员随后展开成普通 `ExperimentDefinition`：

```text
file source + family key
  -> stable Experiment ID
  -> ordinary Experiment link / plan / Run
```

后续 selector、Sandbox link、budget、lock、carry 与 report 不按 family 分支。

## 生命周期

setup 与 teardown 的 owner 是成员 Experiment，不是文件。
一次命令同时选择两个成员时，它们各自运行自己的 hook 对，并各自产生 Run。

作者若把同一个有状态 callback object spread 给多个成员，普通 JavaScript 引用语义仍然成立。
NiceEval 不把它自动复制成独立闭包，也不把它升级成一次 family-level lifecycle。

需要每成员独立状态时，调用返回新闭包的普通工厂：

```ts
function member(input: MemberInput): ExperimentDefinitionInput {
  const lifecycle = serviceLifecycle(input.service);
  return {
    agent: input.agent(lifecycle.endpoint),
    setup: lifecycle.setup,
    teardown: lifecycle.teardown,
  };
}
```

## Identity

成员的 evaluated config、Agent、Sandbox 与其它稳定 inputs 各自进入现有 fingerprint。
family key 进入 Experiment ID，不替代这些输入。

全部成员共享同一个 module source closure。
该文件或它的 runtime dependency 变化时，所有成员保守地得到新的 source identity；系统不按 AST 切函数片段。

这是减少文件数量的显式代价。
需要最小失效面时，继续使用一文件一配置，并把共享常量抽到无副作用的共享模块。

## 错误边界

family 的结构错误使整个文件 discovery 失败，且不产生任何成员：

- key 非法；
- record 为空；
- member 不通过 `defineExperiment()` 共享的字段校验；
- member 传入已经 branded 的 single 或 family definition，而不是 `ExperimentDefinitionInput`。

全项目 discovery 完成后，Runner 继续对最终 Experiment ID 做唯一性校验。
例如 `experiments/compare.ts` 的 family key `baseline` 与 `experiments/compare/baseline.ts` 会同时产生 `compare/baseline`；这是 discovery error，不允许按文件遍历顺序留下其中一个。

成员之间的 Sandbox template conflict、缺配置或 lifecycle 错误仍按成员 ID 报告。
一个成员运行失败不会把同文件其它成员改成同一 Run 或同一 Verdict。
