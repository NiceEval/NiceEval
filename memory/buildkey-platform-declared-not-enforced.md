# BuildKey 的 platform 是声明不是事实

**现象**:BuildKey 按 `linux/amd64` 计算,但 `docker compose build` 从不传 `--platform`,arm64 宿主实构出 arm64 镜像(2026-07-31 真机核实)。后果:两台不同架构的机器对同一题算出相同 CaseKey,携带门会把不可比的结果互认。

**根因**:platform 只参与身份哈希,没有喂给构建执行——身份声明与构建事实脱钩,谁都不报错。

**修法**:已修(2026-07-31),选的是「platform 从构建执行环境探测再进 key」这条,并顺带把该值传给构建执行,两个方向合成一条闭环。

否决「硬编码 `linux/amd64` + 构建显式传 `--platform`」的理由:那会让 Apple Silicon 宿主对每道题走 qemu 跨架构构建,慢到不可用、缺 binfmt 时直接失败,而任务 Compose 是题目自带的、niceeval 不该替它换架构。8c67ae4a 已经立过同一条纪律——目标平台从真实执行的地方探测,并保留显式指定的口子。

落点:`src/sandbox/compose.ts` 新增 `detectDockerBuildPlatform()`(优先 `DOCKER_DEFAULT_PLATFORM`,其次 `docker version` 报的 Server.Os/Arch,再回落宿主架构)与 `normalizeBuildPlatform()`(aarch64/x86_64 归一);`collectComposeBuilds()` 的平台默认值从字面量改成探测值,一并进 work inputs 与 `ComposeBuildCollection.platform`;`dockerComposeBuildProvider().build()` 与物化期那次 `compose build` 都用同一个值设 `DOCKER_DEFAULT_PLATFORM`。契约措辞在 `docs/feature/sandbox/case.md`「BuildKey 与 CaseKey」。

区分力测试:`src/sandbox/compose.test.ts` 注入 `platformProbe` 造 arm64 / amd64 两台宿主,断言 BuildKey 不同、构建执行拿到的平台与进 key 的值同源。

**第二回合(2026-07-31,评审复查发现首轮修法不完整)**:首轮只修了「探测默认值」,Compose 自己的平台声明仍被忽略——`inspectComposeYaml` 不解析 service 级 `platform` 与 `build.platforms`,而 Docker Compose 用它们决定构建平台且压过 `DOCKER_DEFAULT_PLATFORM`。后果与首轮同型:同一 daemon 上两份 Dockerfile/context 相同、平台声明不同的 case 共用 BuildKey。教训:**修「声明与事实脱钩」这类 bug 时,要穷举事实的全部来源**——探测值只是回落层,声明层(Compose 文件)才是最优先的事实来源,只修回落层等于把同一个洞换了个入口。二次修法:逐服务求有效平台(`build.platforms` 单元素 > service `platform` > 探测默认),进各自 BuildKey 并同源交给构建执行;多元素 `build.platforms` 规划期报错拒绝。区分力测试补「声明平台的服务跨宿主身份不动、未声明的跟宿主走、多平台拒绝」。
