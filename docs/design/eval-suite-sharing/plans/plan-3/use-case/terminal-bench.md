# Terminal-Bench：发布方零共享协议改造的用例

**相关文档**：[Library](../library.md) · [CLI](../cli.md) · [Architecture](../architecture.md) · [Lifecycle](../lifecycle.md)

## 目标

一个新的 NiceEval 项目复用 Terminal-Bench 已有原生 Eval。
Terminal-Bench 仓库不增加任何共享专用文件，消费项目也不复制或包装 238 条题。
本方案不声称现有项目的一切运行身份都天然稳定；Terminal-Bench 的 10 条随机 Compose 题是下面明确列出的例外。

## 发布方现状就是交付契约

Terminal-Bench 已有普通 NiceEval 项目结构：

```text
terminal-bench/
├── package.json
├── niceeval.config.ts
├── evals/
│   └── terminal-bench/
│       ├── hello-world/
│       │   ├── eval.ts
│       │   ├── fixture/
│       │   └── tests/
│       └── ...
├── lib/
└── experiments/
```

它继续在自己的仓库里运行和维护这些 Eval。
不新增 `suite.ts`、manifest、package export 或 release 字段。

消费方只会扫描配置指定的 `evals/terminal-bench`。
`niceeval.config.ts` 与 `experiments/` 即使存在于安装内容，也不会被导入。

## 消费方固定 package commit

消费项目把 Terminal-Bench 声明成直接 devDependency。
Git 场景在 `package.json` 写完整 commit：

```json
{
  "devDependencies": {
    "niceeval": "<consumer-version>",
    "terminal-bench": "github:NiceEval/terminal-bench#<full-commit>"
  }
}
```

随后用项目既有 package manager 安装并签入 lockfile：

```sh
pnpm install
pnpm install --frozen-lockfile
```

第一条命令是依赖变更动作，第二条代表 CI 的复现路径，并非要求连续执行。
registry version、私有 Git、tarball 或 workspace 也可使用；NiceEval 不为这些 package 引用增加专用语法。

## 消费方挂载 Eval root

消费项目配置只增加一个挂载：

```ts
// niceeval.config.ts
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

这里显式选择子目录，是为了让 root 内的 `hello-world` 挂成 `terminal-bench/hello-world`。
若直接使用默认 root `evals`，外部 root 的内部 id 已含 `terminal-bench/`，再加同名 mount 会形成重复前缀。

## 检查发现结果

消费项目使用 Node >=22.15。
安装后先运行发现检查：

```sh
pnpm exec niceeval list terminal-bench/
```

检查确认：

- package 是消费项目直接依赖，并能在本地安装树定位；
- `evals/terminal-bench` 位于 package root 内；
- 238 条 Eval 及其源码输入能发现；
- Eval owner 内所有 NiceEval import 由消费运行时提供；
- 发现期登记的 Sandbox、判据和 loader 输入没有逃出外部 package。

这条命令会 import Eval 与共享运行期模块的顶层代码，不是安全沙箱，也不保证无副作用。
需要把核对与执行明确分开时，先运行 `pnpm exec niceeval list --preflight`；它只展示 dependency key、Git commit 或 integrity 等 installed identity，不 import Terminal-Bench Eval。

题数属于当前 Terminal-Bench 输入事实，不写进共享 manifest。
外部项目以后增删题时，发现结果自然跟随已锁定的新依赖内容。

## 用消费项目的 Experiment 跑题

消费项目自己定义 Agent、model、attempts 与预算：

```ts
// experiments/codex.ts
import { defineExperiment } from "niceeval";
import agent from "../agents/codex.ts";

export default defineExperiment({
  agent,
  model: "openai/gpt-5",
  evals: ["terminal-bench/"],
  attempts: 1,
});
```

先看计划，再跑小切片或整套：

```sh
pnpm exec niceeval exp codex terminal-bench/hello-world --dry
pnpm exec niceeval exp codex terminal-bench/hello-world
pnpm exec niceeval exp codex terminal-bench/
```

最后一条可能产生大量付费 Attempt，仍由用户按普通 NiceEval 成本纪律决定是否执行。
共享机制不会因为安装了一套题就自动运行它。

## 运行时发生了什么

以 `hello-world` 为例：

```text
terminal-bench package root
  / evals/terminal-bench
  / hello-world/eval.ts
    → relative id: hello-world
    → mount: terminal-bench
    → project id: terminal-bench/hello-world
```

Eval 模块中的 `import { defineEval } from "niceeval"` 被绑定到消费项目正在运行的 NiceEval。
它通过相对路径 import 的项目内模块、Fixture、tests 与其它 dependency 仍从 Terminal-Bench package 依赖树查找。

`hello-world` 在 `test(t)` 中上传 `tests/` 和 `run-tests.sh`。
这两个字面量 URL 不要求 Terminal-Bench 改写成 `loadCriteria()`。
NiceEval 从模块语法树建立 transfer plan，通用 Sandbox wrapper 在 fresh Attempt 核对并写入 owner-relative manifest。
后续计划先重算内容摘要，再决定是否携带。

Runner 得到的对象与本地 Eval 相同。
它不会加载 Terminal-Bench 的 Experiment，也没有 adapter、wrapper 或第二种结果格式。

## 升级时只重跑改变的题

消费项目把 Git commit 或 package version 升级后，再运行：

```sh
pnpm exec niceeval list terminal-bench/
pnpm exec niceeval exp codex terminal-bench/ --dry
```

package lock 证明安装选择已经改变，NiceEval 逐 Eval manifest 解释哪些 source、dependency、runtime 或 transfer 输入改变。
对身份稳定的 228 条题，只改一条 Eval 时，其它输入闭包相同的结果仍可携带。

只改 Terminal-Bench README、Experiment 或项目配置时，共享 Eval 的指纹不变。
这就是不以 package version 作为整套题失效键的原因。

## 10 条 Compose 题的诚实边界

Terminal-Bench 有 12 条 Compose Eval，其中 10 条的 `harborComposeEnv()` 在模块求值时生成随机 container nonce 和临时日志路径。
NiceEval 不能普遍判断任意 env value 只是操作命名，还是会改变题目语义，因此不能在发布方零改动的同时把这些值武断排除出 Sandbox identity。

第一版裁决是正确性优先：

- 238 条题都能原样挂载和运行；
- 其中 10 条 Compose 题每次新进程得到新 Sandbox identity，保守地不携带；
- 不把“只改一题，其它 237 条都携带”写成全套保证；
- 若以后 Terminal-Bench 自愿采用“运行期值 + 稳定 fingerprint revision”的通用 NiceEval API，这 10 条才获得精确携带。该 API 不是共享协议，也不是挂载前提。

## 发布内容不完整时

如果 registry tarball 排除了 `evals/`，消费方会在 `niceeval list` 得到 root 缺失错误。
这不是要补一个共享 manifest，而是所选 package 内容没有交付配置指定的目录。

有两个修法：

1. 改用包含完整仓库内容的精确 Git dependency。
2. 由 package owner 修正常规 package `files` 或 `.npmignore` 后发布新版本。

两种修法都不要求改写任何 Eval，也不引入 `eval.lock`。
