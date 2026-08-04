# 执行身份沿用环境声明,`root: true` 退役成 `user`

**裁决(2026-08-04)**:Sandbox 执行身份统一成一个词 `user`,默认沿用环境自己声明的身份。

- 省略时:Docker 镜像 `USER`(未声明按 Docker 语义 root)、Compose service `user:`、E2B template 默认用户、宿主当前用户原样生效;runner 不再强加 UID 1000。
- 起点覆盖:`dockerImageSandbox` / `dockerfileSandbox` / `dockerComposeSandbox` / `e2bSandbox` 统一收 `user?: string`,值进 fingerprint;`vercelSandbox` / `localSandbox` 不收(provider 承诺不了的选项不进公共类型)。
- 命令覆盖:`CommandOptions.root?: boolean` → `user?: string`;`{ root: true }` 写成 `{ user: "root" }`。command identity 的 root 位同步换成 user。
- compose 的 `executionUser` 选项与 `"image"` 哨兵删除:省略即镜像默认,不需要哨兵字符串,也消除与真实用户名 `image` 的碰撞。
- 非 root 安全默认搬进可发布产物:官方 coding agent 镜像/模板在配方里声明非 root `USER`(Claude Code 在 root 下拒绝 `--dangerously-skip-permissions`),不藏在 runner 运行时。

**曾选方案**:provider 运行时硬编码 `SANDBOX_UID = 1000` 作为默认执行身份,`{ root: true }` 按需提权;compose 用 `executionUser: "image"` 哨兵表达「沿用镜像」。

**否决理由**:Terminal-Bench 全量运行暴露——226 个 dockerfileSandbox 题假设镜像声明的身份(写 `/app`、`apt-get install`),被静默换成非特权 UID 1000 后约 150/238 attempt 以 `Permission denied` / `sudo: command not found` 失败,而 `dockerfileSandbox()` 没有任何声明入口。静默覆盖不产生报错,只表现为一片权限失败,定位成本极高;环境是题目作者写的,runner 覆盖题目声明的身份属于越权。布尔 `root` 表达不了任意用户,`"image"` 哨兵与真实用户名冲突。

**落点**:契约见 `docs/feature/sandbox/library.md`「执行身份」;实现涉及 `src/sandbox/layer.ts`(factory options 与 command identity)、`src/sandbox/docker.ts`(默认身份、home/PATH/chown 按身份解析)、`src/sandbox/e2b.ts`、`src/sandbox/vercel.ts`、`src/sandbox/local.ts`、`src/types.ts`(`CommandOptions`)。
