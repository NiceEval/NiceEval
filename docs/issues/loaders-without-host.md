# 无宿主进程的 loader 读取阻断普通单元测试

## 观察与期望

NiceEval-Eval 的普通单元测试导入共享模块时，模块顶层调用 `niceeval/loaders` 的 `loadText`，尚未进入 NiceEval 发现也抛出 outside discovery，阻断普通测试。契约要求没有宿主的进程只读并返回；进入发现后才禁止发现期以外的调用，并提供具名 LoaderOutsideDiscoveryError。

公开入口：在普通 Node 进程里 `await loadText(new URL("./fixture.txt", import.meta.url))`；共享模块随后应仍能被同进程的发现完整登记到各可达评估的指纹。

来源为 ne-upstream-dx5 任务书与下游 tests/install-layout.test.ts。基线 NiceEval 4c1bfd8d7、0.0.0-development，Linux、Node 24、pnpm 11。本地 Issue 与相关入口检索没有命中相同项；未执行远端 mutation。本条已脱敏，不含凭证或安全细节。
