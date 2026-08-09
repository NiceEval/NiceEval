# 共享 Eval —— 从已安装 package 挂载原生题目

一棵已经能被 NiceEval 发现的 Eval 目录可以直接跨项目复用。
发布方仍是普通 TypeScript package，不增加 suite manifest、adapter、`eval.lock` 或另一种 Definition。
消费项目安装 package，并用 `evalRoots` 把其中一棵目录加入自己的发现根集合。

```text
package 内的 Eval root
  + root 内相对 Eval id
  + 消费项目挂载前缀
  = 消费项目内 Eval id
```

共享 Eval 进入现有发现、Experiment 选择、Sandbox、指纹、携带与 Record 主线。
这个功能只增加安装 provenance 与 owner 事实，不增加第二套运行模型。

## 消费配置

```typescript
import { defineConfig } from "niceeval";

export default defineConfig({
  evalRoots: {
    "terminal-bench": {
      package: "terminal-bench",
      root: "evals/terminal-bench",
    },
  },
});
```

公开形状为：

```typescript
interface PackageEvalRoot {
  readonly package: string;
  readonly root?: string;
}

interface Config {
  evalRoots?: Readonly<Record<string, PackageEvalRoot>>;
}
```

`evalRoots` 的 key 是项目内挂载前缀。
`package` 是消费项目 `package.json` 里的直接 dependency key，npm alias 应写 alias 名。
`root` 是 package root 内的普通相对路径，省略时为 `evals`。

挂载 `terminal-bench` 后，root 内的 `hello-world/eval.ts` 形成 `terminal-bench/hello-world`。
挂载前缀参与 Eval id；修改前缀会形成新的项目内结果身份。

同一个物理 package owner 不能同时由两个 mount 认领。
本地 Eval 与外部 Eval 形成同一个 id，或同一外部 root 内出现重复入口时，发现阶段报错，不按扫描顺序替换既有定义。

## 安装选择由 package manager 所有

消费项目先用 npm、pnpm 或 Yarn 安装直接依赖并保留 lockfile。
NiceEval 不安装、升级或写回依赖，也不从 package name 和 version 猜测安装内容。

支持的安装身份分成四类：

| 安装形态 | 持久化身份 |
|---|---|
| registry | lock entry 的 integrity |
| tarball | tarball integrity |
| Git | 不可变 commit |
| file / workspace | 排除安装缓存与运行 Record 后的 package tree content digest |

每种身份同时保存 lockfile kind 与去凭据的稳定摘要。
公开 provenance 不包含本机绝对路径、registry token、鉴权 header 或临时下载 URL。

alias 的 dependency key 与安装后 manifest name 是两项独立事实。
同一个 package 可以通过不同 alias 安装成不同实例；NiceEval 必须把实际物理 root 唯一映射到 lock 中的 logical locator。
零匹配或多匹配都报 `eval-root.installation-unverifiable`，不回退到相同 name/version 的另一份安装。

package manager 的 lockfile 固定完整依赖选择。
NiceEval 的逐 Eval manifest 只投影实际运行输入；它不是第二份 lock，也不能用于重建安装树。

## 预检与发现 barrier

外部 root 按固定阶段进入进程：

1. 解码所有 mount，核对直接依赖、lockfile、实际安装 root 与 package metadata。
2. realpath 校验 Eval root 位于 package owner 内，并在执行 package 代码前扫描静态 owner-local 模块边。
3. 一次性激活 owner hook，再导入 Eval 模块并收集 Node 实际查找结果。
4. 发现完成后，把模块 DAG、loader 数据、private / criteria 与 transfer plan 投影到各条 Eval。

任何前置阶段失败时，不导入后续外部 Eval。
错误按 mount 聚合并稳定排序，因此一个坏 root 不会掩盖其它 root 的配置问题。

```sh
niceeval list --preflight
niceeval list --preflight --json
```

`--preflight` 只执行安装与 root barrier，不导入 Eval。
普通 `niceeval list` 会导入外部 Eval 与它的共享模块，因此可以执行模块顶层代码；它不是安全沙箱。

`list --json` 由外层进程独占 stdout / stderr，再用私有协议 fd 接收隔离 worker 的一个 frame。
worker stdout、stderr 或协议超过 1 MiB 时失败；进程或后代没有在 60 秒内关闭协议流时，整棵进程树被终止。
用户 preload 会在执行项目代码前得到 `eval-root.preloaded-owner-unsupported`，不会产生半份 JSON。

## 一个 canonical NiceEval runtime

外部 owner 内的 `niceeval`、`niceeval/loaders`、`niceeval/sandbox` 与 `niceeval/expect` import 都绑定消费方 runtime。
这个规则同时适用于 ESM 与 CommonJS，避免 package 自己嵌套安装的 NiceEval 产生另一套私有品牌或 Definition 契约。

同步模块查找 hook 必须在配置与 Eval 动态导入前注册。
因此启用 `evalRoots` 需要 Node 22.15 或更高版本；没有外部 root 的本地命令不受这条 feature gate 限制。

外部 owner 的相对模块、loader 文件、Sandbox build context、bind mount 与 transfer source 都必须留在 package root 内。
静态或运行期 realpath 逃逸报 `eval-root.outside-package`。
bare dependency 可以位于 hoisted 或 nested `node_modules`，但必须由 Node 的实际 target 与 package-manager adapter 共同确认实例。

## 逐 Eval 指纹与携带

共享 Eval 的指纹继续使用现有两层模型，并增加外部执行事实：

```text
fingerprint = hash(
  configHash,
  project Eval id,
  Eval 源码闭包,
  实际可达 bare dependency locator / content identity,
  NiceEval runtime contract revision,
  loader、criteria 与 private 输入,
  Sandbox 身份,
  可重验 transfer 输入,
  EvalDefinition 运行字段
)
```

package 的展示 name、version、repository、安装 provenance 和整份 lockfile digest 不是整套题的失效键。
无关 lockfile 条目改变不能作废所有共享 Eval；只有这条 Eval 实际可达的 dependency identity 参与指纹。

模块图以 TypeScript AST 产生候选，再以 Node/tsx hook 实际观察的 target、conditions 与 package instance 闭合。
静态 import/export、顶层 literal `import()` 与未 shadow 的顶层 literal `require()` 可以进入可携带闭包。
不能完备证明的动态模块能力仍可 fresh run，但会写结构化 limitation，并使 Attempt 不可携带。

静态可求值的 `uploadFile()` 与 `uploadDirectory()` 在计划期形成 owner-relative transfer plan。
Attempt 发送前先生成不可变 snapshot；hash 与 provider 读取同一份 bytes，目录 snapshot 不保留 symlink。
计划不匹配时不调用 provider，动态 transfer 则允许 fresh run但不可携带。

`accept` 不会把动态证据强行变成可携带结果。
静态 transfer plan 改变时，用户须用报错给出的精确 digest 显式授权：

```sh
niceeval accept @LOCATOR --accept-transfer sha256:CURRENT_PLAN_DIGEST
```

## Definition 与 execution provenance

每条外部 Eval 的公开 descriptor 带 `origin`。
fresh Attempt 在 `result.json` 内联三项完整事实：

- `definitionOrigin`：本轮发现时的 package provenance；
- `executionOrigin`：这份结果实际执行时的 package provenance；
- `executionInputs`：transfer、运行期模块边、limitation 与携带资格。

结果被携带到新 Run 时，definition origin 更新成当前安装 provenance，execution origin 保留原执行 provenance。
这样 package 升级但单题输入不变时，读取面既能解释当前定义，也不会把旧结果伪装成由新 commit 执行。

三项事实必须 attempt-inline 保存。
`run.json.definitionOrigins` 只是索引，旧 writer 白名单重建 run metadata 后仍不能丢失权威 provenance。

## 支持边界

- 外部 package 必须是消费项目直接依赖，并存在 npm、pnpm 或 Yarn node-modules 可核验的 lock 与安装树。
- Yarn Plug'n'Play 不提供本功能要求的 node-modules owner tree，预检返回 `eval-root.yarn-pnp-unsupported`。
- 上游 `niceeval.config.ts`、Experiment 与 Agent 不会被自动导入；消费项目拥有运行选择。
- package 必须实际交付 Eval、Fixture 与运行期 dependency。内容被 `files` 或 `.npmignore` 排除时，修正普通 package 交付或使用完整 Git dependency。
- 共享 package 是受信任的可执行依赖。owner containment 防止输入意外逃逸，不是抵抗同进程恶意代码的安全沙箱。
- Eval 选择 Docker、E2B 或 Vercel 等 provider 时，消费项目仍须按该 provider 的普通用法安装 canonical NiceEval runtime 所需的 optional peer。

公开操作步骤见[共享评估教程](../../../docs-site/zh/tutorials/share-evals.mdx)。
候选比较、否决理由与 PLAN-3 裁决保留在[共享 Eval 设计存档](../../design/eval-suite-sharing/DECISION.md)。
