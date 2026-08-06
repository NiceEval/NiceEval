# Library：消费项目挂载外部 Eval 根

**相关文档**：[README](README.md) · [CLI](cli.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Case](use-case/README.md)

## 发布方没有新 API

不存在 `defineEvalSuite()` 或其它发布方共享 API。
发布方继续使用现有 `defineEval()`、`defineScoreEval()` 与 `evals/` 发现约定。

NiceEval 不要求来源项目：

- 新增 `suite.ts` 或 manifest；
- 在 package exports 暴露入口；
- 为题目再声明 id、release 或成员清单；
- 把自己的配置或 Experiment 导出给消费方；
- 为共享用途改变现有 dependency 声明。

## `Config.evalRoots`

消费项目用 record 把已安装 package 的一个 Eval root 挂到项目内前缀：

```ts
interface PackageEvalRoot {
  /** 消费项目 package.json 中直接声明的 dependency 名。 */
  readonly package: string;
  /** 相对来源 package root 的发现根；默认 `evals`。 */
  readonly root?: string;
}

interface Config {
  readonly evalRoots?: Readonly<Record<string, PackageEvalRoot>>;
}
```

```ts
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

这里的 `terminal-bench` key 是项目内挂载前缀。
来源 root 中的 `hello-world/eval.ts` 因而得到最终 id `terminal-bench/hello-world`。

### `package`

`package` 必须是消费项目 `package.json` 中的直接 dependency、devDependency 或 optionalDependency。
NiceEval 从消费项目的已安装依赖树定位 package root，不导入 package main，也不要求 `package.json` export。

直接依赖要求使来源在代码审查与 lockfile 中可见。
不能用一个偶然存在的传递依赖作为共享题来源。

### `root`

`root` 省略时为 `evals`，与普通 NiceEval 项目约定一致。
它必须是使用 `/` 的普通相对路径，不能包含空片段、`.`、`..`、反斜线或控制字符。

解析符号链接后的真实 root 必须位于来源 package root 内。
若安装内容没有这个目录，配置装载直接失败。

### 挂载 key

挂载 key 可以含多个普通路径片段，如 `third-party/security`。
它不能以 `/` 开头或结尾，也不能含空片段、`.`、`..`、反斜线或控制字符。

外部根不提供 include、exclude 或单题重命名。
运行子集继续使用 Experiment 的 `evals` 与 CLI 位置参数，避免发现层和运行层各有一套选择规则。

## 来源投影

挂载后的 EvalDescriptor 增加只读 `origin`：

```ts
interface ExternalEvalOrigin {
  readonly kind: "package";
  readonly mount: string;
  readonly root: string;
  readonly relativeEvalId: string;
  readonly package: {
    readonly name: string;
    readonly version?: string;
    readonly repository?: string;
    readonly license?: string;
  };
}

interface EvalDescriptor {
  readonly origin?: ExternalEvalOrigin;
}
```

本地 `evals/` 发现的 Eval 没有 `origin`。
Experiment 可以用 `e.origin?.package.name` 选择来源，但普通前缀选择仍是最短路径。

name、version、repository 与 license 从来源 package 已有的 `package.json` 读取。
绝对安装路径、registry token、tarball URL 与本地 cache 路径不进入公开投影。

版本字段允许省略，因为 workspace 或私有 package 可能没有合法 version。
可复现安装身份的 owner 仍是消费项目 lockfile，来源投影不复制它的完整解析记录。

## 原生 NiceEval import

共享 Eval 文件继续写普通 import：

```ts
import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";
import { dockerImage } from "niceeval/sandbox";
```

发现器在外部 package root 内装载模块时，把 `niceeval` 与 `niceeval/*` 解析到当前 CLI 所属 package。
来源项目自己的 devDependency、workspace node_modules 或嵌套安装不会获得第二份运行时所有权。

其它 bare package import 从来源 package 的依赖环境解析。
若消费 NiceEval 缺少 Eval 使用的 export，发现错误同时标出来源 package 和 Eval 文件。

## 不存在的 API

- 没有 DatasetDefinition 或 ExternalEvalDefinition；成员仍是 EvalDefinition。
- 没有发布方定义、格式适配器或共享入口。
- 没有外部题专用结果格式；共享 Eval 继续产生普通 Record。
- 没有 `eval.lock`；依赖版本只由项目 package lock 管理。
- 没有运行时覆盖外部 EvalDefinition 的 merge API。
