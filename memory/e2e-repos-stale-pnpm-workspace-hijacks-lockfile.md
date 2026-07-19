---
name: e2e-repos-stale-pnpm-workspace-hijacks-lockfile
description: "e2e/pnpm-workspace.yaml(旧 apps/projects/shared 架构遗留)会把 e2e/repos/<id> 下的 pnpm install 顶到 e2e/ 根的共享 lockfile/node_modules,而不是给新独立仓库生成自己的 pnpm-lock.yaml"
metadata:
  type: infra-bug
---

**现象**：在 `e2e/repos/cli-contract`(独立测试仓库,见
`docs/engineering/e2e-ci/README.md` §2.1/§2.2)里直接 `pnpm install`,命令报
"Lockfile passes supply-chain policies (verified 5d ago)"、瞬间完成,但仓库目录下
既没生成 `pnpm-lock.yaml` 也没生成 `node_modules`——依赖其实装到了 `e2e/node_modules`,
版本锁在 `e2e/pnpm-lock.yaml` 里。这会让 `test/e2e-structure.test.ts` 的「每个仓库都有
自己的 lockfile」检查失败,而且 `e2e/pnpm-workspace.yaml` 里还有一条
`overrides: { niceeval: link:.. }`(指向 niceeval 根 checkout 的 `link:` 依赖),一旦
真被当作该 workspace 成员,my `package.json` 声明的发布版基线会被静默换成这个越界
`link:`,直接违反 README §2.1「不使用指向父目录的 file:/link: 依赖」。

**根因**:`e2e/pnpm-workspace.yaml`(`packages: []`,带 `allowBuilds` 白名单和上面那条
`niceeval: link:..` override)是老架构(`e2e/apps` + `e2e/projects` + `e2e/shared`,见
`e2e/README.md`)的产物,新的 `e2e/repos/*` 独立仓库迁移(`e2e-repo-autonomy-replaces-
shared-suite` 裁决)还没清理它——这属于任务清单里单独的「Cleanup old e2e/ layout」收尾
项,尚未执行。pnpm 判定 workspace 根的规则是从 cwd 向上找最近的 `pnpm-workspace.yaml`,
`packages: []` 只影响"这个 workspace 声明了哪些成员参与联动构建",不阻止 pnpm 把任何
向上能找到该文件的子目录当成"该 workspace 下的孤儿项目"处理、复用同一份根 lockfile。

**修法**：不要改动 `e2e/pnpm-workspace.yaml`(其它并行 agent 正在依赖它跑旧架构,且
delete/cleanup 是任务 #15 的专职范围)。在自己的独立仓库目录里跑
`pnpm install --ignore-workspace` 生成真正独立的 `pnpm-lock.yaml` + `node_modules`
(已验证:生成的 lockfile 解析到真实发布版 `niceeval@0.9.1`,不含任何 `link:`/`file:`
逃逸;`e2e/pnpm-lock.yaml` 的 mtime 全程不变,证明没有污染根 workspace)。仓库自己的
`scripts/e2e.ts` 在"仅当 node_modules 缺失才自动 install"分支里也要带上
`--ignore-workspace`,覆盖"直接在本 checkout 原地跑 `pnpm e2e`(未经编排器复制到隔离
目录)"这条路径;编排器把仓库复制到 OS tmp 目录后本就在该 workspace 之外,这个 flag 此时
是无操作,不影响真实验收路径。适用于 `e2e/repos/*` 下任何新独立测试仓库,在旧 `apps/
projects/shared` 布局被清理(任务 #15)之前都会踩到。
