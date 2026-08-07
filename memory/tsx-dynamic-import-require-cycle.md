# CJS 宿主目录下 CLI 加载不了自己 init 生成的 config

**现象**:用户项目 `package.json` 无 `"type": "module"`(`npm init -y` 默认产 `"type": "commonjs"`)时,CLI 经 tsx 动态 `import()` 用户 `.ts` 文件(`niceeval.config.ts`、`--report` 报告文件)必崩——`niceeval init` 成功(只写文件),下一步 `niceeval list` 就加载不了它 3 秒前生成的 config。`loadConfig` 与 `src/show/index.ts` 的 `loadReportFile` 共享同一装载机制,两处都踩。报错措辞随 Node 版本与 tsx hook 注册面变化,根因同一个:

- 只注册 ESM hook(HEAD 的 `bin/niceeval.js`,Node 22.21):`SyntaxError: Cannot use import statement outside a module`——tsx 警告后落进未挂钩的 CJS loader,Node 拿裸 TS 当 JS 解析。
- ESM+CJS 双 hook(部分已发布版本形态):`ERR_PACKAGE_PATH_NOT_EXPORTED`——config 被编成 CJS,`require("niceeval")` 打到 exports 表,`"."` 只有 `types`+`import` 无 `require` 条件。
- 另有环境报 `ERR_REQUIRE_CYCLE_MODULE`(本条目最初记录的形态,2026-07 实现 `show --report` 时发现)。

**根因**:tsx 按最近 `package.json` 的 `type` 决定把 `.ts` 编成 ESM 还是 CJS;宿主是 CJS 时 config 走 CJS 路径,而 ① bin 只注册了 `tsx/esm/api` 的 hook(CJS loader 无人转译),② niceeval 所有 exports 出口都没有 `require` 条件。宿主写没写 `"type": "module"` 纯看用户/agent 掷硬币——canary.4 时 gpt-researcher 沙箱能跑是 agent 恰好写了,db-gpt 两轮崩是 `npm init -y` 产物。

**修法**:已修(2026-07-24,同日复现验证 + 落地)。包侧修是**两件套,缺一不可**——只补 require 条件不加 CJS hook 实测照崩(崩在解析 exports 之前):

- `bin/niceeval.js` 同时注册 `tsx/esm/api` + `tsx/cjs/api` 两个 hook;
- `package.json` exports 全部出口补 `"require"` 条件指向同一文件(`.ts` 由 tsx CJS hook 转译)。

复现方法(scratchpad symlink 本仓库为安装包):CJS 宿主 `init`+`list` 走通、eval 文件 import `niceeval/expect` 子路径走通、ESM 宿主行为不变。另有体验兜底:`init` 检测最近 `package.json` 非 ESM 时输出一行建议(`cli.init.esmHint`,只提示不改文件,CJS 编译面用不了顶层 await 所以 ESM 仍是推荐形态);INIT.md 教 agent 新建 `package.json` 时写 `"type": "module"`。契约落在 docs/cli.md「装载用户 .ts:宿主模块形态无关」,守护测试 `test/unit/package-exports.test.ts`(exports require 条件 + bin 双 hook 两条不变量)。

## 回归 kill 收据

`b44420d3` 的 fix parent 在无 `"type": "module"` 的宿主中可完成 `niceeval init`，但紧接的 `niceeval list`
最早因未转译 TS 或缺少 `require` export 失败；只补任一半也仍失败。修复提交的真机收据覆盖 CJS `init → list`、
子路径 import 与 ESM 对照。目标 Package E2E owner 是
`docs/roadmap/testing/example/repos/package/test/commonjs-init-list.test.ts`：叶子 Repo 本身声明 `"type": "commonjs"`，
先由 candidate 执行 `init`，再由新的 CLI 进程执行 `list`。恢复任一旧半边实现时，最早失败点固定在 `list` 的 exit / diagnostic。
