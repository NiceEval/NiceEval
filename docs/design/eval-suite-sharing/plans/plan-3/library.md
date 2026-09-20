# Library：消费项目挂载外部 Eval 根

**相关文档**：[README](README.md) · [CLI](cli.md) · [Architecture](architecture.md) · [Lifecycle](lifecycle.md) · [Use Case](use-case/README.md)

## 发布方没有新 API

不存在 `defineEvalSuite()` 或其它发布方共享 API。
发布方继续使用现有 `defineEval()`、`defineScoreEval()` 与 `evals/` 发现约定。

NiceEval 不要求外部项目增加共享协议：

- 新增 `suite.ts` 或 manifest；
- 在 package exports 暴露入口；
- 为题目再声明 id、release 或成员清单；
- 把自己的配置或 Experiment 导出给消费方；
- 仅为共享而新增或改写 dependency 声明。

“零新增”指不写 NiceEval 共享专用代码或 metadata，不表示任意仓库天然是完整 package。
所选 package 内容仍须包含 Eval 输入，并按普通 JavaScript package 规则正确声明运行期 bare dependency；Git dependency 是 Terminal-Bench 第一版无需发布改造的交付路径，registry tarball 则必须以实际 pack 内容验收。

## `Config.evalRoots`

消费项目用 record 把已安装 package 的一个 Eval root 挂到项目内前缀：

```ts
interface PackageEvalRoot {
  /** 消费项目 package.json 中直接声明的 dependency key；允许 npm alias。 */
  readonly package: string;
  /** 相对外部 package root 的发现根；默认 `evals`。 */
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
外部 root 中的 `hello-world/eval.ts` 因而得到最终 id `terminal-bench/hello-world`。

### `package`

`package` 字段表示消费项目 `package.json` 中的直接 dependency key，可以是普通 package name，也可以是 alias。
NiceEval 从消费项目的已安装依赖树定位 package root，不导入 package main，也不要求 `package.json` export。

直接依赖要求使 package owner 在代码审查与 lockfile 中可见。
不能用一个偶然存在的传递依赖作为共享题 package。
安装后读取到的 manifest `name` 是 package identity，不要求与 dependency key 相等；因此 `tb-v1: npm:terminal-bench@1` 和 `tb-v2: npm:terminal-bench@2` 可以同时挂载。

### `root`

`root` 省略时为 `evals`，与普通 NiceEval 项目约定一致。
它必须是使用 `/` 的普通相对路径，不能包含空片段、`.`、`..`、反斜线或控制字符。

跟随符号链接后的真实 root 必须位于外部 package root 内。
若安装内容没有这个目录，配置装载直接失败。

### 挂载 key

挂载 key 可以含多个普通路径片段，如 `third-party/security`。
它不能以 `/` 开头或结尾，也不能含空片段、`.`、`..`、反斜线或控制字符。

外部根不提供 include、exclude 或单题重命名。
运行子集继续使用 Experiment 的 `evals` 与 CLI 位置参数，避免发现层和运行层各有一套选择规则。

## Package provenance 投影

挂载后的 EvalDescriptor 增加只读 `origin`：

```ts
type InstalledPackageIdentity =
  | {
      readonly kind: "git";
      readonly commit: string;
      readonly lockfile: "pnpm" | "npm" | "yarn";
      readonly lockDigest: string;
    }
  | {
      readonly kind: "registry" | "tarball";
      readonly integrity: string;
      readonly lockfile: "pnpm" | "npm" | "yarn";
      readonly lockDigest: string;
    }
  | {
      readonly kind: "workspace" | "file";
      readonly contentDigest: string;
      readonly lockfile: "pnpm" | "npm" | "yarn";
      readonly lockDigest: string;
    };

interface ExternalEvalOrigin {
  readonly kind: "package";
  readonly mount: string;
  readonly root: string;
  readonly relativeEvalId: string;
  readonly dependency: string;
  readonly package: {
    readonly name: string;
    readonly version?: string;
    readonly repository?: string;
    readonly license?: string;
  };
  readonly installed: InstalledPackageIdentity;
}

interface EvalDescriptor {
  readonly origin?: ExternalEvalOrigin;
}
```

本地 `evals/` 发现的 Eval 没有 `origin`。
Experiment 可以用 `e.origin?.package.name` 选择 package，但普通前缀选择仍是最短路径。

name、version、repository 与 license 从外部 package 已有的 `package.json` 读取。
installed identity 从消费项目 lockfile 与实际安装位置只读投影；Git commit 和 registry/tarball integrity 保留，URL 中的凭据、绝对安装路径、registry token 与本地 cache 路径不进入公开投影。

版本字段允许省略，因为 workspace 或私有 package 可能没有合法 version。
可复现安装身份的 owner 仍是消费项目 lockfile；provenance 投影只保存审计与携带所需的规范化事实，不成为第二份安装锁。

Record 区分本轮 `definitionOrigin` 与产生结果的 `executionOrigin`。
carry 更新前者、保留后者，不能把旧结果伪装成由新 commit 执行。

## 原生 NiceEval import

共享 Eval 文件继续写普通 import：

```ts
import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";
import { dockerImage } from "niceeval/sandbox";
```

在 Node >=22.15 上，发现器在外部 package root 内装载模块时，把该 owner 内模块的 `niceeval` 与 `niceeval/*` 指向当前 CLI 所属 package。
外部项目自己的 devDependency、workspace node_modules 或嵌套安装不会获得第二份运行时所有权。

其它 bare package import 从外部 package 的依赖树查找。
若 Node linker 能确认消费 NiceEval 缺少 Eval 使用的 export，发现错误同时标出外部 package 和 Eval 文件；运行期属性访问仍可能在普通发现或执行错误中暴露。

这项能力不是“任意 TypeScript 都能神奇装载”的承诺。
实现必须保留外部 package 的 module type 与 tsconfig 语义，并用 ESM/CJS 安装矩阵验收；无法完备查明的动态依赖会禁用该 Eval 的携带，而不是静默漏进指纹。

## 不存在的 API

- 没有 DatasetDefinition 或 ExternalEvalDefinition；成员仍是 EvalDefinition。
- 没有发布方定义、格式适配器或共享入口。
- 没有外部题专用结果格式；共享 Eval 继续产生普通 Record。
- 没有 `eval.lock`；依赖版本只由项目 package lock 管理。
- 没有运行时覆写外部 EvalDefinition 的 merge API。
