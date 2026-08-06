# Terminal-Bench：发布方零改造的共享题用例

**相关文档**：[Library](../library.md) · [CLI](../cli.md) · [Architecture](../architecture.md) · [Lifecycle](../lifecycle.md)

## 目标

一个新的 NiceEval 项目复用 Terminal-Bench 已有原生 Eval。
Terminal-Bench 仓库不增加任何共享专用文件，消费项目也不复制或包装 238 条题。

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

## 消费方固定来源

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
registry version、私有 Git、tarball 或 workspace 也可使用；NiceEval 不为这些来源增加专用语法。

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
若直接使用默认 root `evals`，来源内部 id 已含 `terminal-bench/`，再加同名 mount 会形成重复前缀。

## 检查发现结果

安装后先运行只读检查：

```sh
pnpm exec niceeval list terminal-bench/
```

检查确认：

- package 是消费项目直接依赖，并能在本地安装树定位；
- `evals/terminal-bench` 位于 package root 内；
- 238 条 Eval 及其源码输入能发现；
- Eval 内所有 NiceEval import 由消费运行时提供；
- 发现期登记的 Sandbox、判据和 loader 输入没有逃出来源 package。

题数属于当前 Terminal-Bench 输入事实，不写进共享 manifest。
来源项目以后增删题时，发现结果自然跟随已锁定的新依赖内容。

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
它通过相对路径 import 的项目内模块、Fixture、tests 与其它 dependency 仍从 Terminal-Bench package 环境解析。

Runner 得到的对象与本地 Eval 相同。
它不会加载 Terminal-Bench 的 Experiment，也没有 adapter、wrapper 或第二种结果格式。

## 升级时只重跑改变的题

消费项目把 Git commit 或 package version 升级后，再运行：

```sh
pnpm exec niceeval list terminal-bench/
pnpm exec niceeval exp codex terminal-bench/ --dry
```

package lock 证明安装来源已经改变，NiceEval 逐 Eval manifest 解释哪些实际输入改变。
只改一条 Eval 时，其它 237 条输入闭包相同的结果仍可携带。

只改 Terminal-Bench README、Experiment 或项目配置时，共享 Eval 的指纹不变。
这就是不以 package version 作为整套题失效键的原因。

## 发布内容不完整时

如果 registry tarball 排除了 `evals/`，消费方会在 `niceeval list` 得到 root 缺失错误。
这不是要补一个共享 manifest，而是所选 package 来源没有交付配置指定的目录。

有两个修法：

1. 改用包含完整仓库内容的精确 Git dependency。
2. 由来源项目修正常规 package `files` 或 `.npmignore` 后发布新版本。

两种修法都不要求改写任何 Eval，也不引入 `eval.lock`。
