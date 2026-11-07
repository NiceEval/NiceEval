# 裁决:配置只从代码来,环境变量只放凭据与终端事实

**日期**:2026-07-25(用户裁决)。契约落点 `docs/architecture.md`「配置从代码来,凭据从环境来」;用户文档 `docs-site/zh/tutorials/configuration.mdx`(英文对应页同步)。

## 裁决

环境变量在 niceeval 里只剩两个合法用途:**凭据**(变量名由 adapter / sandbox 工厂或 `judge.apiKeyEnv` 声明,只读自己家族那一个名字)和**终端环境事实**(`NO_COLOR`、系统 locale)。其它一切从 CLI flag / experiment / `niceeval.config.ts` 读。

删掉的读取(实现在同一批):

- `NICEEVAL_RUNS` / `NICEEVAL_TIMEOUT` / `NICEEVAL_BUDGET` / `NICEEVAL_MAX_CONCURRENCY` —— `src/cli.ts` 的 `envNumber` 整层连函数删除,`cli.envInvalidNumber` 两份词条一起删。
- judge 的 `NICEEVAL_JUDGE_MODEL`、`NICEEVAL_JUDGE_BASE`,以及跨家族回落 `CODEX_BASE_URL` / `OPENAI_BASE_URL` / `CODEX_API_KEY` / `OPENAI_API_KEY`。model 只从 config、baseUrl 只从 config(默认官方端点)、key 只读 `judge.apiKeyEnv` 指定的变量或 `NICEEVAL_JUDGE_KEY`。
- `NICEEVAL_LANG` / `NICEEVAL_LOCALE` —— 新增 `config.locale`,取值链改成 `config.locale` → `LC_ALL` → `LC_MESSAGES` → `LANG` → `zh-CN`。
- `NICEEVAL_BUB_OVERRIDE` / `NICEEVAL_BUB_OTEL_PLUGIN` —— bub 的 fork pin 回到源码常量,不留环境后门。

保留内置默认变量名(用户明确选的那一档):`ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL`、`CODEX_API_KEY` / `CODEX_BASE_URL`、`BUB_API_KEY` / `BUB_API_BASE`、`E2B_API_KEY`、`VERCEL_*`、`NICEEVAL_JUDGE_KEY`。判据是**名字属于谁**:`ANTHROPIC_*`/`CODEX_*` 这些是那个工具自己的官方约定,niceeval 只是照着读;`NICEEVAL_*` 的配置类变量是 niceeval 自己发明的,全删。

## 否决方案

- **凭据也走"config 声明变量名、零内置默认"**:否决(用户裁决)。零配置开箱即用更重要,`claudeCodeAgent()` 不该逼用户写 `apiKeyEnv: "ANTHROPIC_API_KEY"`。
- **语言只读 `config.locale`、完全不看系统 locale**:否决。中文环境下裸跑 `npx niceeval`(还没有配置文件时)恒英文太差。
- **保留 env 层但收窄**:否决。三条来路的代价是"为什么本地和 CI 不一样"要靠翻环境回答,而环境不进快照、不进指纹。

## 两个实现上的坑

1. **`config.locale` 要在命令派发之前注入**,而 `show` / `view` 按契约不依赖配置文件。做法:`src/cli.ts` 的 `applyConfiguredLocale()` 在 `loadDotenv` 之后跑一次可选装载,**配置文件缺失或本身报错时静默回落系统 locale**——语言是装饰性设置,不该让 `niceeval show` 因为一个坏 config 打不开结果;真正需要 config 的命令随后走 `loadConfig` 报完整错误(模块缓存让这次装载不重复付出代价)。
2. **私有网关地址这类"想从环境注入的配置值"没有被堵死**:配置是代码,在自己的 `niceeval.config.ts` 里写 `process.env.MY_GATEWAY`(`.env` 已加载完)。仓库自己的 e2e fixture 就是这么改的——`baseUrl: process.env.NICEEVAL_JUDGE_BASE` 从 niceeval 内置读改成各 e2e 项目自己读。**说服力检验:这条边界不是"不许用环境变量",是"niceeval 不替你猜变量名"**。

## 守护

`test/unit/config-env-boundary.test.ts` 扫 `src/` 下非测试源码实际读取的环境变量名,断言全部落在白名单内(白名单是那份边界表的机器可读副本)。加一个配置类环境变量回来就红,不需要预先知道它叫什么名字。注意正则要排除**写**入子进程 env 的赋值(`env.BUB_MODEL = …` 是把配置传下去,不是读配置),第一版没排除,被 bub 的 model 注入误报。
