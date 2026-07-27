# 修改 Sandbox 预置

## 场景

起步环境靠 SandboxSpec Hook 装出来:装一个 CLI、拉一份配置、写一个种子文件。
Hook 里换掉一个包的大版本,agent 手上的工具链就换了——这比在 eval 文件里
加一个空行对结果的影响大得多,而加空行会作废那一条。

`template` 不变但重建了同名镜像是同一类事:起步环境换了,名字没换。

## 怎么写

高频预置写成声明式 recipe：

```typescript
sandbox: e2bSandbox({ template: "niceeval-agents" })
  .recipe([
    {
      run: {
        command: "npm",
        args: ["install", "--global", "some-cli@2.1.0"],
      },
    },
  ]),
```

recipe 是 `ExecutionManifest` 的一部分。
把 `some-cli@2.1.0` 改成 `@3.0.0` 后，相关 Requirement 变化，默认派发。
改 Experiment 的 description、labels 或字段顺序不改变 Requirement。

provider 在解析期把 template / image 名解析成 immutable 内容 ID。
同名镜像重建后内容 ID 变化，相关 Evidence 自动失效。

## 边界

任意 `.setup(fn)` 仍可使用，但函数源码不能代表闭包值和运行环境。
只哈希 `Function#toString()` 会同时产生两种错误：

- 源码没变、捕获的版本值变了，错误沿用；
- 只有格式或转译结果变了，无谓重跑。

因此没有 recipe 或 observer 能说明身份的 Hook 使相关 Requirement 变成 `opaque`，
默认每次派发。要恢复自动沿用，就把稳定步骤改成 recipe，
把外部资源版本改成 Experiment resource observer。

mutable image 无法解析内容 ID 时也归为 `opaque`，不能静默退化成只比较名字。
