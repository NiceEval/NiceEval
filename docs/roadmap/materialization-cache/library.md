# Materialization Cache —— Library

缓存没有独立作者配置入口。
作者通过需要宿主供给的稳定声明表达需求，Runner 从声明中导出 Host Materialization Demand。

## Git checkout

`checkout` 是下游切换同一 GitHub repository base commit 的官方入口。
每道 Eval 声明自己的 commit；Runner 自动复用宿主已经取得的 Git objects。

```ts
import { checkout } from "niceeval/sandbox";

interface CheckoutOptions {
  readonly repository: string;
  readonly commit: string;
  readonly into?: string;
}

declare function checkout(options: CheckoutOptions): StableSandboxCommand;
```

字段是穷尽的：

| 字段 | 必填 | 语义 |
|---|---|---|
| `repository` | 是 | 匿名公共 HTTPS Git repository；URL 不含 userinfo、query 或 fragment |
| `commit` | 是 | 完整 40 位 SHA-1 commit OID；大小写归一为小写 |
| `into` | 否 | Sandbox workdir 相对目录；省略或 `.` 表示根目录，不能越过 workdir |

`repository` 保守按规范化后的完整 locator 区分。
V1 不根据 redirect、`.git` 后缀、大小写或托管平台知识猜两个 URL 指向同一 repository。

`commit` 只接受 immutable OID。
branch、tag、短 SHA 与其它浮动 ref 在 link 时失败；错误发生在 origin、cache backend 与 Sandbox I/O 之前。

## 写法

```ts
const BASE_COMMIT = "3f7c1f9a03e70cc13eaa9bdb7db891f26f74a836";

export default defineEval({
  sandbox: sandboxLayer().prepare(checkout({
    repository: "https://github.com/acme/project.git",
    commit: BASE_COMMIT,
  })),
  async test(t) {
    await t.send("修复当前仓库中的问题。");
  },
});
```

缓存自动生效。
作者不提供 cache key、mirror path、projection format、credential、shallow、history 或 Provider 选项。

完整题组写法见[同仓库多道题](use-case/同仓库多道题.md)，子目录写法见[`into` 子目录](use-case/检出到子目录.md)。

## 可见历史

Sandbox 初始 repository 包含：

- 声明 commit；
- commit 的全部祖先；
- 这些 commit 引用的 tree 与 blob。

它不包含 descendant、旁支、tag object、额外 ref、remote-tracking ref、reflog 或不可达 object。
V1 不提供 shallow 或 history policy 旋钮。

## 不支持输入

以下输入以具名配置错误拒绝：

- `http:`、SSH、SCP-style、`file:` 与本地路径；
- 含凭据、query 或 fragment 的 URL；
- branch、tag、短 SHA 与 SHA-256 OID；
- 需要认证的 repository；
- submodule 或 Git LFS hydration 请求。

`.gitmodules` 与 LFS pointer 可以像普通 blob 一样出现在历史中，但 V1 不自动获取它们指向的内容。
