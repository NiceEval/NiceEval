# 生命周期统一成对 setup/teardown,否决 setup-returns-cleanup

**裁决(2026-07-18)**:experiment / eval / agent / sandbox 四层生命周期统一为成对 `setup` / `teardown` 字段(方法),`setup` 返回 `void`;`Cleanup` 返回值从全部公开钩子签名移除(类型保留为内部注册表用)。触发规则全局统一:teardown 当且仅当同层 setup **时点**走到过(setup 抛错不豁免、未声明 setup 不影响触发、时点没走到则跳过);LIFO;setup 链中断后 teardown 链仍完整走完。契约中枢在 `docs/runner.md`「环境预置不进运行器,但按顺序调它」。

**曾选方案(被否决)**:`setup` 返回 cleanup 作为 teardown(React useEffect / pytest yield / Go t.Cleanup 谱系)。当时的理由写在旧版 `docs/feature/experiments/README.md`:「teardown 只在 setup 真正跑过之后才有意义,返回式注册天然绑定这层因果」。

**否决理由**:
1. agent / sandbox 层当时**两种风格并存**(成对方法 + 返回式),一件事两个写法;Vitest globalSetup 同时支持两种、文档要专门解释执行顺序,是反面教材。
2. 返回式的结构性洞:setup 半途抛错(容器已 up、cleanup 还没 return)→ 收尾**永远丢失**——正是 nowledge 孤儿容器事故的根源之一。成对字段让 teardown 在触发时点就静态可达(实现里注册表登记提前到 triggered 时刻)。
3. 「闭包状态通道专属返回式」的论据不成立:契约本来就规定 setup 产物写模块级变量给 agent/sandbox 钩子读,同一通道给 teardown 字段用零成本。
4. 文件里看不到 teardown 的可见性问题(用户真实误读:「只有 setup 是不是 bug」)。

**连带裁决**:
- 状态通道粒度跟层的节奏走:实验级(整场一次)用工厂闭包/模块变量;每 attempt 层并发共享模块,普通变量互相覆写,以 `sandbox` 实例作键(`WeakSet`/`WeakMap`)。第一稿统一规则曾写「一律写模块闭包」,是错的,已修正。
- `postSetup` 的收尾配对命名为 `preTeardown`(不是 postTeardown):postSetup 跑在 agent 安装之后,preTeardown 跑在 agent 收尾之前,LIFO 镜像自描述。
- 迁移护栏:tsx 用户无类型检查,四层 setup 返回函数时运行时抛清晰错误(指向成对 teardown);实验级额外 best-effort 先执行一次返回的旧 cleanup 再报错,迁移期不留孤儿。

**落点**:docs 批次 commit `ebfa6c6`/`6799f24`/`609a43c`/`4447f7b`;实现批次见其后 commit(`src/runner/{types,run,attempt}.ts`、`src/agents/{types,post-setup,claude-code,codex,bub}.ts`、`src/sandbox/types.ts`)。
