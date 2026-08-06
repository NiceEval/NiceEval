# Repo 验收：`consumer-project` Recipe backend

本篇定义测试体系的 `consumer-project` backend 目标契约，遵守 [Roadmap 约定](../../README.md)。

## 裁决

Repo 验收不是第二套 acceptance 体系，也不替代 Behavior、Portfolio、World、DSL 或 Outcome。
它已经归入 [NiceEval 测试体系重构](../README.md)的 `consumer-project` Recipe backend。

这个 backend 只回答一件事：怎样把一个真实消费方项目准备成可冻结、可复现、可由候选 tarball 驱动的 World。
“用户必须完成什么任务”仍由 Behavior 声明；“观察结果怎样按领域身份读取”仍由所属 E2E 仓库的 DSL adapter 负责。

```text
Behavior + Execution Registration
                │
                ▼
Evidence Recipe ── backend: "consumer-project"
                │
                ▼
外部项目骨架 → 安装候选 tarball → 运行真实 CLI → 发布只读 World
                │
                ▼
Vitest verifier + 所属领域读面 → Behavior Outcome
```

## Backend 契约

```ts
interface ConsumerProjectRecipeBackend {
  readonly kind: "consumer-project";
  project(
    name: string,
    options: {
      fixture?: string;
      packageType?: "commonjs" | "module" | "absent";
      tsconfig?: false;
      jsx?: "react" | "react-jsx";
      omitOptionalPeers?: readonly string[];
    },
  ): Promise<ConsumerProject>;
}

interface ConsumerProject {
  readonly name: string;
  readonly root: string;
  installCandidate(tarball: string): Promise<void>;
  write(relativePath: string, fixturePath: string): Promise<void>;
  cli(
    shellLiteral: string,
    options?: {
      expect?: number | "nonzero";
      pipe?: boolean;
      streams?: "merged";
    },
  ): Promise<PreparedProcess>;
  freeze(): Promise<ConsumerTreeRef>;
}
```

`freeze()` 必须记录项目树摘要与 lockfile 摘要。候选包生成的 config、Report 构建物和运行结果不能预烘进
跨候选缓存；它们属于 candidate 绑定层。`node_modules` 使用复制落盘，不能靠硬链接让可变 clone 写穿共享 store。

## 它拥有与不拥有的职责

| Backend 拥有 | Backend 不拥有 |
|---|---|
| 外部 cwd、package type、tsconfig 与 lockfile | Behavior ID、用户任务与契约锚点 |
| 候选 tarball 安装与实际解析身份 | matcher、Report 领域词与浏览器动作 |
| 真实 CLI、stdout / stderr / exit 收据 | cadence、风险等级与 release blocking 清单 |
| optional peer 缺席、CJS、foreign Report 等消费矩阵 | 另一个 runner、另一个 Registry 或平行 CI 入口 |
| consumer tree 与进程 evidence 的冻结 | 从候选实现导入预期或私有 schema |

## 典型矩阵

同一个 `package-consumers-v1` Recipe 准备下列四个有独立区分力的项目，具体用户结果由一个矩阵 owner 证明：

| consumer | 有区分力的边界 | 代表旧缺陷 |
|---|---|---|
| `commonjs-init` | CommonJS 下 `init → list` | CJS loader / exports |
| `minimal-no-optional-peers` | 不安装 `dockerode` / `e2b`，运行不使用它们的 CLI | optional peer 冷路径被静态 import |
| `foreign-report` | 宿主 cwd 与 TSX Report 项目不同 | 相邻 tsconfig、JSX runtime 与候选包类型检查 |
| `runnable-doc-example` | 复制公开 example 后原样执行 | 文档 key / flag 与实际 API 漂移 |

矩阵可以拆成多个项目目录，但 Registry 中只有一个 owner。新增 consumer 需要指出它排除的错误实现；不能为了
“多一种 package.json”机械加题。

## 命令与自治

每个所属 E2E 仓库仍只有一个 `scripts/e2e.ts`。完整运行、prepare 和单例 verify 都走它：

```sh
pnpm e2e
pnpm e2e -- prepare
pnpm e2e -- verify --world <manifest> --behavior packages.consumer-matrix
```

根 `e2e/scripts/run.ts` 只负责构建候选、选择仓库与透传 behavior filter。它不解析 Recipe、World 或产品断言。
将一个 E2E 仓库复制到独立 checkout 后，它仍可只靠自己的命令完成准备与验证。

## 准入与退役

backend 遵守主方案的完整门槛：当前候选绿、历史逆补丁红、同形反证红、非契约扰动仍绿、malformed observer
显式失败、用户代码不加探针。引入消费方矩阵时，只为本批实际替代或删除的 package export、Report loader 和
旧线性 E2E 提交 Retirement Manifest；不要求先给全仓旧测试做 100% 映射。没有独有用户结果或机制风险的重复
矩阵直接删除。

完整代码形态见[测试方案 Example](../example/README.md)。
