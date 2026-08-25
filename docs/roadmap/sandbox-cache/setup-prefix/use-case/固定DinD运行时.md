# 固定 DinD runtime

Harness 的 outer image 携带固定 runtime archive。Docker BuildKey 命中时，每个新 DinD Sandbox 的 inner daemon 仍从空 data-root 启动。Experiment 因此把固定 runtime 导入声明为一个低频 `dockerData` Action，再用后置默认 `all` Action 复制 workspace 与 home。

```ts
import {
  actionRef,
  changeFrequency,
  dockerSandbox,
  sandboxState,
  shell,
} from "niceeval/sandbox";

const harness = dockerSandbox({
  source: { type: "dockerfile", context: HARNESS_CONTEXT },
})
  .before(shell({
    id: "import-inner-runtimes",
    command: "/usr/local/bin/niceeval-runtime-import",
    changeFrequency: changeFrequency.rare,
    cache: { state: sandboxState.dockerData },
  }))
  .before(shell({
    id: "prepare-workspace-and-home",
    command: "/usr/local/bin/niceeval-workspace-prepare",
    dependsOn: [actionRef("import-inner-runtimes")],
  }));
```

runtime Action 的全部副作用只能落在 inner `/var/lib/docker`。它不能顺带复制 `/home/node`、写 workspace、创建 outer marker 或读取 secret。这些效果由后置 `all` Action 或 opaque callback 完成，因为 Profile 的 Docker-data artifact 无法替代它们。

```text
BuildKey hit
  → import-inner-runtimes prefix hit (state dockerData, frequency 10)
  → prepare-workspace-and-home barrier replay (state all)
  → public adapter-env replay (barrier suffix, frequency 1000)
  → inject secret overlay
  → Agent/test
```

普通 Docker 在全部可变状态都位于 outer writable rootfs 时可以保存默认 `all`，因而继续从 exact image 命中最长前缀。Docker Profile 只在 seed 与 slot 都是独立 fixed-size filesystem image 时保存 `dockerData`。shared loop-ext4/project-quota Profile 仍报告 `Unsupported`并真实导入 runtime。

暖运行从 immutable seed 恢复到新的 writable slot。后续 Agent/test 可以修改 inner image 或 volume，下一次命中仍必须看到未污染的 seed。outer workspace/home 每次重新复制，所以不会从上一台 Sandbox 遗留。

只改 Eval/test 时，BuildKey 与 runtime SetupPrefixKey 不变。只改公开 `.env` 时，runtime 前缀仍命中，barrier 与后缀按新输入重新执行。canary tag 先查找精确版本与 package digest；tag 仍指向同一版本时命中，更新时自然产生新 identity，不需要 `noCache`。

含 secret 的 `.env`、token、credential binding、运行中 inner container 与 BuildKit session 不进入 Docker-data prefix。Adapter 用高频 callback 注入真实 token，成功后通过 `context.onCleanup()` 登记清除。
