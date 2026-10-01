---
format: concord.document/v1
id: keep-dormancy-provider-forms
title: 设计裁决:留存现场转入 provider 休眠形态(keep ≠ 继续跑)
createdAt: 2026-07-14T22:32:51+08:00
createdAtSource:
  kind: first-recorded
  path: memory/keep-dormancy-provider-forms.md
  commit: 28047ab511ebcfdaa2360058794e2b294e9aec50
kind: memory
memoryKind: decision
state: current
epoch: 0
promotions: []
history: []
---
# 设计裁决:留存现场转入 provider 休眠形态(keep ≠ 继续跑)

- **裁决**(2026-07-14):`--keep-sandbox` 的留存提交成功后,provider 把现场转入自己最持久的低成本形态——docker `stop` 停驻(fs 落盘、不占内存、跨 daemon 重启存活,enter 内联 `docker start && docker exec`)、e2b `pause`(fs+内存持久化、按存储计费、保留期内 `resume` 找回)、vercel 无休眠通道(留存 = 不 kill,TTL 内如实展示)。`sandbox list` 新增 `dormant` 状态。契约落在 `docs/feature/sandbox/architecture.md` 留存节 + `docs/feature/sandbox/cli.md`。
- **曾选方案:留存 = 保持运行**。docker 不带 AutoRemove 一直跑、e2b 活到 session TTL。否决理由:docker 白烧 CPU/内存;e2b 既烧计算又留不住(TTL 一到现场蒸发),「过一会回来 debug」根本不成立。
- **同场否决**:`docker pause`(内存驻留、daemon 重启即失,比停驻更脆);`docker commit` 转镜像(引入第二种要管理的资源面,停驻容器已给出同等持久性)。
- 来源:用户提出「哪些 provider 能暂停、事后找回,作为 keep 的另一种实现」,采纳为契约。
- **同日第二轮评审修正 provider 事实**(初版凭印象写错两家):E2B pause 官方契约是暂停期间**停止计费、无限期保留**,不是「按存储计费、有保留期限」——`expiresAt` 对 e2b 不写;Vercel **有**休眠通道(persistent sandbox 默认开,`stop` 保存文件系统、`Sandbox.get`/`getOrCreate` 恢复,本仓库 node_modules 里 SDK README 已描述 resume),初版「无休眠通道只能等 TTL」是错的。同轮补齐:suspend 建模为独立生命周期阶段(`sandbox.suspend`,失败 → 注册表 state 保持 alive + diagnostic,不冒充 dormant)、`niceeval sandbox enter`(唤醒→shell→退出自动回休眠,`--leave-running` 例外)。教训:provider 能力结论落契约前先查官方文档或本地 SDK,不凭训练记忆。
