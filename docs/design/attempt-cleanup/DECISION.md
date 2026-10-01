# 裁决

## 定案

采用[候选一](PLAN-1/README.md)。独立 GPT-6 Astra 审查认可配置归属与公开形状，无 P0。
三项 P1 分别为附件中止重入、迟到 cleanup 唤醒与直接 Effect 中断。
Architecture 已明确三项修正及单一计时起点；实现须由公开生命周期回归证明。

## 依据

Adapter 实现知道资源排空协议。只增加一个实现选项即可满足实际需求，并保留现有各层资源 owner。

## 否决项

候选二给运行者统一调节能力，但重新分配 Agent 与 Sandbox finalizer 预算，超出当前缺口的必要范围。
应用模拟 Agent Turn 不解决 cleanup 时限，也会要求即时制系统虚构输入和行动归属，因此不采用。

## 遗留风险

应用对真实物理请求的完成回执负责，Framework 只能关闭采集入口并报告超时。
第二次 OS signal 或外部进程强杀不保证归档完成。公开 Host Effect 取消仍需独立验收。
