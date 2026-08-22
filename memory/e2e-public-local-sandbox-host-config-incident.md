---
name: e2e-public-local-sandbox-host-config-incident
description: E2E 公开 localSandbox 把测试命令放进宿主 HOME/config 信任域；安全红灯证明测试自有 HOME sentinel 被改写，所有 owner 已迁出该边界
metadata:
  type: infra-bug
---

**事故来源链**：`e2e/adapter/codex-app-server` 为确定性 app-server fixture 使用公开
`localSandbox()`。安装后 CLI 显式收到测试自有 `HOME` 与 `CODEX_HOME`，但 Sandbox 进程仍处于
宿主进程与文件系统信任域。Codex 配置装配于是能沿宿主可写路径触及 `HOME/.codex/config.toml`。
这与早先 [`codex-sdk-e2e-codex-home-personal-config-leak`](codex-sdk-e2e-codex-home-personal-config-leak.md)
同属 ambient config 泄漏：后者证明个人配置会污染协议行为，这次进一步证明 host Sandbox 会改写配置字节。

**安全红灯**：父侧用精确旧候选
`candidate-0ef75f6e8d8107d60a56d596d168fddea493ae1c2b1532ba443ebcb37ef449dc.tgz`
从安装后的公开 CLI 运行新增的 `adapter-codex-app-server-host-config-isolation` owner。case 只创建测试自有
`HOME` / `CODEX_HOME`，分别写入不同 sentinel，并在命令结束后逐字节复核。正式复现命令是
`pnpm e2e run --candidate <old-candidate.tgz> --repo adapter/codex-app-server -- --run test/host-config-isolation.test.ts`；
旧候选 SHA-256 为 `0ef75f6e8d8107d60a56d596d168fddea493ae1c2b1532ba443ebcb37ef449dc`，owner 得到
`homeUnchanged=false`、`codexHomeUnchanged=true`。真实 `$HOME/.codex` 从未进入 argv、fixture、断言或收据路径。
该方法既杀死旧实现，也不以探测真实 HOME 来证明“隔离”。

**为何完全移除而不是只补 HOME**：覆盖 `HOME` 只能修正一条已知配置路径，不能把 host 进程移出宿主文件系统、
权限、socket、进程和其它 ambient config 的信任域。公开 Local 还会让与安全无关的 owner 继续默许真实宿主状态进入
测试输入，后续新增 CLI 或工具时会再次扩大事故面。因此所有依赖公开 `localSandbox()` 的 E2E owner 都迁出：需要
真实隔离边界的 Codex 与 CLI owner 使用 digest-pinned、非 root、固定 HOME 的 Node Docker；只证明 generic exclusive
scheduler 或分段读取的场景改用 test-only custom provider，并把 `HOME`、`CODEX_HOME`、`TMPDIR` 固定在各自隔离 Repo 副本。
Lifecycle 删除 Local 对照，只保留 Docker managed-process owner。

**后续 E2E 规则**：

- E2E 不得用公开 host Sandbox 运行会发现、读取或写入用户配置的 CLI；隔离 HOME 不能替代权限边界。
- Docker fixture 使用不可变 image digest、非 root 用户、固定 `HOME` / `CODEX_HOME` / `TMPDIR`，并在 cleanup 收据中证明容器终结。
- test-only custom provider 必须显式标名为 custom/controlled，不得在名称、注释或 marker 中暗示公开 Local 产品能力；
  其子进程环境只接收确定性签入输入和 case 私有目录。
- 安全回归只检查测试自有 sentinel；禁止继承、探测、复制或把真实 HOME / config 写入 artifact。
- `SkillSpec { kind: "local" }` 表示签入 Skill 来源，不是 Sandbox provider，保留且在检索时与 `localSandbox` 分开统计。
