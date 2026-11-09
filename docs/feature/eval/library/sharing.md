# 挂载已安装项目的 Eval

消费项目可以把已安装 package 的 Eval 目录挂到项目内前缀，与本地 `evals/` 一起选择和运行。
成员仍是原生 Eval，结果仍使用普通 Record。发布方继续维护自己的 Eval、资产与运行期依赖，不需要共享入口、manifest 或专用 package export。

## 配置外部根

`defineConfig` 接受以下发现配置；这里只列出 `Config` 的 `evalRoots` 部分，其它配置由各自 Feature 定义。

```ts
interface PackageEvalRoot {
  /** 消费项目 package.json 中直接声明的 dependency key，允许 npm alias。 */
  readonly package: string;
  /** 相对外部 package root 的发现根，默认 evals。 */
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

外部 root 中的 `hello-world/eval.ts` 得到最终 id `terminal-bench/hello-world`。
配置省略或为空时，只使用本地发现根。挂载只增加可发现的 Eval，实际运行范围仍由 Experiment 与 CLI 选择决定。

| 输入 | 约束 |
| --- | --- |
| `package` | 消费项目直接 dependency key，必须已安装；不接受偶然存在的传递依赖 |
| `root` | 默认 `evals`，必须是使用 `/` 的非空普通相对路径；真实目录必须位于 package root 内 |
| record key | 消费项目内挂载前缀，可含多个普通路径片段，例如 `third-party/security` |

`root` 和挂载 key 都不能以 `/` 开头或结尾，也不能含空片段、`.`、`..`、反斜线或控制字符。
root 不存在时装载失败。最终 id 冲突时列出双方文件、package、root 与挂载点，不按本地优先或配置顺序替换。

dependency key 与安装后 `package.json` 的 `name` 分开保存。
因此 `tb-v1: npm:terminal-bench@1` 和 `tb-v2: npm:terminal-bench@2` 可以挂到不同前缀。
NiceEval 不执行 package main，也不要求导出 `package.json`。

## 安装与内容边界

package manager 负责安装、版本选择与升级，项目 lockfile 是依赖选择的唯一依据。
支持 registry、私有 registry、Git、tarball、workspace 与 file dependency 的 node_modules 安装树，包括 npm、pnpm 与 Yarn node-modules linker。
Yarn Plug'n'Play 不在该装载契约内。

NiceEval 只读取已安装内容与 lockfile，不联网安装，不生成 `eval.lock`，也不修改依赖锁。
发布内容必须包含 Eval、可达项目模块、Fixture、判据与 Sandbox 构建输入，普通运行期依赖须正确声明。
tarball 排除必需文件时，应修正常规 package 内容，或使用包含这些文件的精确 Git dependency。

消费项目只扫描指定 root，不装载上游的配置、Agent 或 Experiment。
上游拥有题目与运行输入，消费项目的 Experiment 拥有 Adapter、model、attempts、flags、预算与选择。
消费配置不提供外部 Eval 的 patch、merge、include、exclude 或单题改名；修改题目应升级上游依赖或挂载 fork。

## 安装身份

外部 Eval 的 `EvalDescriptor.origin` 使用以下只读形状；完整 descriptor 见 [Experiments](../../experiments/README.md#defineexperiment-的形状)。

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
```

本地 Eval 不设置 `origin`。package 展示字段读取已安装的 `package.json`；没有合法 version 时可以省略。
`installed` 从消费项目 lockfile 与实际安装内容只读投影，不能只用 name/version 代替 Git commit 或 integrity。
投影去除 URL 凭据、token、鉴权 header、临时下载 URL、宿主绝对路径与本地 cache 路径。

Record 区分当前定义的 `definitionOrigin` 与实际执行的 `executionOrigin`。
携带时前者反映本轮 package，后者保持原 Attempt 的精确安装身份；规则见 [身份与携带](../../experiments/architecture/cache.md#外部-eval-的身份与携带)。

## 原生 import 与路径

外部根要求 Node >=22.15。外部 package 内的 `niceeval` 与 `niceeval/*` import 使用启动当前命令的消费运行时。
其它依赖仍从外部 package 的依赖树查找；外部 package 自己的另一版 NiceEval 不参与原生定义解释。
每个 package 保持自己的 module type 与 tsconfig 语义。

NiceEval 受管路径以 Eval 所属 package root 为边界，包括相对 import、loader、build context、bind mount 与上传的宿主文件。
路径或符号链接逃出该边界时失败。挂载不放宽隐藏判据、solution 或参考答案的既有隔离规则。
模块装载与文件访问不变量见 [Architecture](../architecture.md#外部-eval-发现与装载)。

## 检查与升级

安装精确依赖并签入 lockfile 后，先用 `niceeval list --preflight` 查看将执行的安装身份，再发现与运行。
普通 `list` 会导入 Eval 的顶层代码；它是可执行依赖检查，不是安全沙箱。
命令与错误见 [Eval CLI](../cli.md)。

升级依赖后，`exp --dry` 解释逐 Eval 的输入变化。无关文档、上游配置或未引用文件改变不使整套题失效。
随机运行身份或无法完整重验的动态输入会保守重跑；零共享协议改造不保证任意 Eval 都能跨进程携带。

外部项目不参与消费项目的 Run 级 before/after；每条 Eval 使用原有 Sandbox 与 Attempt 生命周期。
运行结束不增加外部题专用 finalizer，package 继续留在依赖树中。
