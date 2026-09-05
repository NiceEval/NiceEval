---
format: niceeval.memory/v1
id: site-dev-removes-active-next-cache
title: 第二次产品站 dev 启动会删除仍在使用的 Next dev 目录
createdAt: 2026-09-05
kind:
  type: problem
  state: open
promotions: []
---
# 第二次产品站 dev 启动会删除仍在使用的 Next dev 目录

P2；2026-09-05，审查基线 `6c6d5ce39414df86be304fb3ed6923d27aae775a`。来源：parent review，父 agent 独立复核。入口：`apps/site/scripts/dev.mjs:36`。

产品站 dev 脚本发现首选端口被占用后自动选用下一端口，却仍无条件删除同一个 .next/dev。若首个实例来自同一 checkout，第二次启动会移除首个实例使用的缓存和 lock 文件。

`scripts/dev.mjs` 的 DEV_CACHE_DIR 固定为 .next/dev，rmSync 不检查 owner。安装的 Next 16.3.2 默认启用 lockDistDir；setup-dev-bundler 在实际 distDir 下取得 lock。端口探测只能证明端口可用，不能证明共享构建目录可删除。尚未运行两实例实验，避免破坏工作区现有 dev 状态。

待验证：在可丢弃的站点 fixture 启动一个真实 Next dev 并保持可访问，再从同目录启动第二个。应保留首实例及其输出；若不能支持共享目录并行，第二次应明确拒绝。不能用删锁文件绕过框架的 ownership 检查。

状态保持 open。本记录不代表产品 E2E 红灯、修复转绿或可靠性接管已完成。

## 2026-09-05 修复验收

父 agent 在独立临时目录启动真实 Next 开发实例：第二实例因现有 Next lock 被拒绝，首实例锁文件保持且 HTTP 返回 200。删除启动时无条件清空 .next/dev 的代码，端口回退逻辑保持。两个实例进程组和临时目录均已回收。

实现与上述仓库入口验收已完成；当前结构化 fixed 门只接受产品 E2E 凭据，尚无仓库 DX 凭据类型，因此保留 open，不借用无关产品 case 宣称 resolved(fixed)。
