# CI typecheck 因死掉的 legacy dist 桥接导入而红

## 现象

main CI 与 v0.7.0 Release 的 `pnpm run typecheck` 同根因失败:`TS2307: Cannot find module '../../dist/report/built-ins/index.js'`(`src/show/report-host.ts` 的 `loadBuiltInDefinition`)。本地一直是绿的,CI 干净 checkout 必红。

## 根因

`3a21458`(报告库按新契约整体重写)把源码目录 `src/report/built-ins`(复数)改名为 `src/report/built-in`(单数)后,`report-host.ts` 里 INTEGRATION(1) 的旧桥接仍导入 `dist/report/built-ins/index.js`,且该导入没有 `as string` 抹除,tsc 会在 typecheck 期真实解析模块路径。改名后干净的 `pnpm run build:report` 永远不会再产出复数目录,该导入成了悬空引用。

本地绿是假象:`dist/` 被 gitignore,本地 `dist/report/built-ins/` 是改名前构建留下的陈旧产物,恰好让 tsc 解析成功。CI 干净构建没有这份残留,于是暴露。

另外这条桥接本身是死代码:它守护的是**内建**报告入口,而内建报告恒随本包源码由 `prepare` 构建,不存在「旧格式产物」场景(与 INTEGRATION(2)/(3) 不同——那两条处理用户自带 `--report` 文件,可能真是旧格式,是活代码)。

## 修法

删除 legacy 回退块,`loadBuiltInDefinition` 直接 `await import("../../dist/report/built-in/index.js")` 取默认导出(dist 带 `.d.ts`,静态解析没问题;CI 的 typecheck 在 install→prepare→build:report 之后跑,dist 一定在)。修在 `src/show/report-host.ts`。

**教训**:涉及 `dist/**` 路径的改名/删除后,本地验证要先 `rm -rf dist && pnpm run build:report` 复现 CI 的干净条件再 typecheck——陈旧 dist 会掩盖悬空引用(同族条目:[stale-dist-report-type-identity-typecheck](stale-dist-report-type-identity-typecheck.md) 是反向场景——陈旧 dist 让 typecheck 假红;本条是陈旧 dist 让 typecheck 假绿)。
