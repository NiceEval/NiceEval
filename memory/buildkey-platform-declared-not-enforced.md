# BuildKey 的 platform 是声明不是事实

**现象**:BuildKey 按 `linux/amd64` 计算,但 `docker compose build` 从不传 `--platform`,arm64 宿主实构出 arm64 镜像(2026-07-31 真机核实)。后果:两台不同架构的机器对同一题算出相同 CaseKey,携带门会把不可比的结果互认。

**根因**:platform 只参与身份哈希,没有喂给构建执行——身份声明与构建事实脱钩,谁都不报错。

**修法**:未修。两个方向选一:构建显式传 `--platform` 让事实跟随声明;或 platform 从构建事实/沙箱探测得出再进 key(与 8c67ae4a「目标平台改从沙箱探测」同方向)。修的时候补「声明 amd64 + arm64 宿主」的区分力场景。
