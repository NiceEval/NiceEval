# Agent env 的 PATH 被 Sandbox 静默覆盖，加 pathPrepend 显式扩展入口

## 现象

MemoryBench 想给某个 hooks / 子进程用的可执行文件前置一段私有目录，写了 `codexAgent({ env: { PATH: "..." } })`，实际执行时不生效——找不到原因。

`docs/feature/adapters/sdk/codex-cli/README.md` 声明 `env` 为每次 Codex CLI 进程「追加环境变量」，未写任何例外；但 `src/sandbox/docker.ts` 的 `runCommand` 把 `PATH: this.sandboxPath` 放在 `...opts.env` 之后，任何调用方传的 `PATH` 都被无条件覆盖，且零报错、零诊断。

## 根因

PATH 在 docker provider 里本来就是"受管变量"——`sandboxPath` 由 npm 全局目录 + 系统默认路径拼出，用来保证 agent、npm 全局安装、题目命令都能找到正确的可执行文件。这个约束本身合理，问题是：

1. 它只在 `CommandOptions.env` 的类型注释里提了一句"不保证能被覆盖"，容易被读成"尽力而为"而非"恒定覆盖"。
2. Codex adapter 的 `env` 契约字面上不带这个例外，两份文档互相矛盾。
3. 没有任何显式入口能让作者达成"扩展 PATH"这个正当需求——静默覆盖之外，作者没有第二条路。

## 修法

1. `codexAgent({ env })` 在工厂函数体内（构造期，先于 `defineSandboxAgent`）同步拒绝 `env.PATH`，不留到 `setup()` 才发现值被丢弃；错误信息指向 `pathPrepend`（`src/agents/codex.ts`）。
2. 新增 Sandbox factory 级 `pathPrepend: string[]`：按声明顺序前置到受管 PATH，覆盖 docker(image/dockerfile/compose 共用同一条 `DockerSandbox` 消费路径)、e2b、vercel、local 四个内置 provider；docker 直接并入 `sandboxPath` 计算，e2b/vercel 在脚本自己的 shell 里对 `$PATH` 前置（这两家原本完全不管 PATH，只能靠 shell 展开），local 前置到 `process.env.PATH`。
3. `pathPrepend` 进入各 factory 的 template identity（`src/sandbox/layer.ts`），改值使旧结果失效，与改 `image` / `user` 同一类。
4. `CommandOptions.env` 与 `CodexConfig.env` 的类型注释同步改为指路 `pathPrepend`，不再是唯一暗示。

## 守护

`src/agents/codex-env.test.ts`（config.env.PATH 同步报错）与 `src/sandbox/docker.test.ts`（`pathPrepend` 按声明顺序前置于受管 PATH、省略时行为不变、不受 `opts.env.PATH` 覆盖）。
