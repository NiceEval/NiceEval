# 裁决:两级并发闸按持有期分工——全局位管吞吐,实验闸全程持有管正确性

**日期**:2026-07-23

**裁决**:全局并发位与实验级 `maxConcurrency` 闸按**持有期**区分语义。全局位只在 attempt 真正执行时占用,内部等待(turn 退避、等实验级 setup)一律让位——纯吞吐,无互斥承诺。实验级闸的名额与 attempt 同生命周期:沙箱创建前取得,teardown 链与沙箱销毁完成后归还,**任何内部等待都不释放**(含 turn 退避)。`maxConcurrency: 1` 因此是严格临界区,共享状态实验不需要在钩子里自己加锁。文档落点:`docs/runner.md#调度有界并发`(语义单点)、`docs/feature/experiments/use-case/concurrency.md`(用例手册)。

**曾选方案与否决理由**:

- **现状(退避把 runSem 一并释放)**——实证击穿串行契约(见 [turn-retry-backoff-releases-experiment-serial-lock](turn-retry-backoff-releases-experiment-serial-lock.md)),否决。
- **拆两个字段**(`serial: true` 管正确性 + `maxConcurrency` 管调度)——两个旋钮一个几乎蕴含另一个,`maxConcurrency: 1` 不串行会成为永久 footgun;否决。
- **退避连全局位也不释放**(一把语义)——全局位本无正确性承诺,不释放牺牲真实吞吐(429 风暴拖垮整批)换不到任何保证;否决。

**支撑论证**:即便实验闸只用于降速,agent 被限流进退避时向同实验放行更多 attempt 只会加重限流——不释放对降速用途同样正确。死锁核查:退避睡醒持实验闸等全局位,与起跑定序(实验闸 → 全局位)一致,无环等待。

**同场裁决(文档体裁)**:用户裁定 docs 不写规则式散文——契约落成用例手册(一个用例 = 场景 + 搭配代码 + 会看到的行为),主 md 只留定义 + 一句保证 + 引用用例文档。用例统一归 `docs/feature/experiments/use-case/`(该目录 07-21 已存在,含 CLI 输入面全流程用例;本次新增「主题速查手册」体裁四篇:concurrency / lifecycle / flags-labels / eval-selection),复杂规则段落都应抽用例进这个目录。
