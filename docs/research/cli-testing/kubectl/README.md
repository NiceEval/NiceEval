# kubectl

## 证据范围

kubectl 的命令测试、Kubernetes E2E framework 与 Prow job 分布在三个官方仓库。本页分别固定到：

- kubectl [`dee3483a3d6a64c07fdf746caf80af446dee99ac`](https://github.com/kubernetes/kubectl/tree/dee3483a3d6a64c07fdf746caf80af446dee99ac)
- kubernetes [`b882c60b4023bdf09264c2d5d30a2cadebc240fb`](https://github.com/kubernetes/kubernetes/tree/b882c60b4023bdf09264c2d5d30a2cadebc240fb)
- test-infra [`b99dc8ca80bd8ec41c25c30770f4177c818001e7`](https://github.com/kubernetes/test-infra/tree/b99dc8ca80bd8ec41c25c30770f4177c818001e7)

主要源文件与目录：

- [`kubernetes/hack/make-rules/test-cmd.sh`](https://github.com/kubernetes/kubernetes/blob/b882c60b4023bdf09264c2d5d30a2cadebc240fb/hack/make-rules/test-cmd.sh)：构建并运行本地 command suite。
- [`kubernetes/test/cmd/util.sh`](https://github.com/kubernetes/kubernetes/blob/b882c60b4023bdf09264c2d5d30a2cadebc240fb/test/cmd/util.sh)：临时工作目录、命令断言与 cleanup 函数。
- [`kubectl/test/e2e`](https://github.com/kubernetes/kubectl/tree/dee3483a3d6a64c07fdf746caf80af446dee99ac/test/e2e)：针对真实集群的 kubectl E2E。
- [`kubectl/pkg/cmd/plugin`](https://github.com/kubernetes/kubectl/tree/dee3483a3d6a64c07fdf746caf80af446dee99ac/pkg/cmd/plugin)：plugin 发现与执行的实现和 unit tests。
- [`kubernetes/test/e2e/framework`](https://github.com/kubernetes/kubernetes/tree/b882c60b4023bdf09264c2d5d30a2cadebc240fb/test/e2e/framework)：namespace、resource lifecycle 与 leak 检查框架。
- [`test-infra/config/jobs/kubernetes/sig-cli`](https://github.com/kubernetes/test-infra/tree/b99dc8ca80bd8ec41c25c30770f4177c818001e7/config/jobs/kubernetes/sig-cli)：Prow 的 kubectl、Kind、GCE 与版本偏斜 lane。

## 1. 已构建或已安装 CLI 如何进入测试

**事实。** `make test-cmd` 先构建 kubectl、API server 等所需 binary，再由 `hack/make-rules/test-cmd.sh` 查找 build output 中的候选路径。kubectl E2E 还接受 `--kubectl-path`，让同一行为 suite 指向明确的候选 executable。

**推断。** 入口是显式 artifact path，不依赖宿主 PATH 中碰巧存在的 kubectl。NiceEval 的本地与 CI suite 也应只消费 `CandidateReceipt` 中的入口。

## 2. 临时真实 repo 或 cluster fixture 怎样创建和隔离

**事实。** Command suite 使用 `KUBE_TEMP`、测试专用 HOME 与临时 kubeconfig，并启动本地 etcd/API server。面向真实集群的 E2E 为测试创建唯一 namespace，把资源生命周期绑定到该 namespace。

**推断。** kubectl 的隔离对象不是源码目录，而是用户配置、控制面和 namespace。NiceEval 应按产品真实状态边界隔离 repo、HOME、cache、record root、server storage 与 adapter 配置。

## 3. stdout、stderr、exit、JSON 与 golden 如何断言

**事实。** Shell harness 把 stdout、stderr 与 exit 分开检查，并使用 JSONPath、Go template 或完整对象输出验证结构化结果。部分所谓 exact 比较函数实际调用 `diff -iwB`，会忽略空白和大小写，而不是逐字节相等。

**推断。** 比较函数的名称不能代替精确定义。NiceEval 的 matcher 必须声明 normalization；JSON 应解码后按 schema/字段断言，人类文本才使用明确规则的 golden。

## 4. plugin 或外部进程协议怎样分层

**事实。** Unit tests 可用 fake verifier 验证 plugin 发现分支。Command/E2E tests 则把真实 `kubectl-*` executable 放入 PATH，由 kubectl 正常发现并启动，再检查 argv、子进程变量和 `KUBECTL_PATH` 等协议可见行为。

**推断。** Fake 只拥有选择逻辑，PATH plugin E2E 拥有 executable wiring。NiceEval 也应把 adapter codec、local executable 和 secret-backed provider 分给不同 owner。

## 5. 本地、Docker、CI 与 secret/live lane 怎样同构

**事实。** 开发者和 Prow 的 command lane 都回到 `make test-cmd`。Prow 可以在容器化 job 中运行同一入口；Kind、GCE、凭据宿主与版本偏斜另有专门 job，不复制 shell suite 的断言实现。

**推断。** Docker、Kind 和 GCE 是 executor / 资源 provider，不是三套测试产品。NiceEval 应让本地、Docker 和 CI 调同一 repo runner，再用 capability 选择只能由 live 服务证明的风险。

## 6. 长流程 user journey 与资源 cleanup 怎样验证

**事实。** Command suite 用 trap 关闭本地 server 并删除临时目录。E2E framework 在用例后删除 namespace，并轮询资源是否消失；Prow job 可启用 `--check-leaked-resources` 检查集群残留。

**推断。** “发送删除请求”只是 cleanup 动作，“查询不到资源”才是 cleanup 证据。NiceEval 应同样等待 PID 消失、端口可重新绑定、临时 Record 已删除或远端资源查询为空。

## 7. unit 与 E2E 矩阵怎样去重

**事实。** kubectl 用 fake IO/REST 的 unit tests 验证命令分支，用本地 API server 的 command suite 验证真实 binary 与 HTTP wiring，再用真实 cluster/版本偏斜 lane 验证集群特性和兼容性。

**推断。** 三层按失败类别分责，避免每个 OS、集群和版本都重复所有数据解码细节。NiceEval 的 unit、installed CLI、local adapter 与 live provider 也应各有唯一 matrix owner。

## 对 NiceEval 的直接启示

- 同一 runner 可以接受不同 candidate path 和 executor / 资源 provider，但产品断言不应复制。
- Plugin/adapter 测试必须至少有一层走真实 PATH/executable 协议。
- Cleanup 要从动作升级为可观测 postcondition，并在 CI 增加 leak scan。
- 不照搬庞大的 privileged 集群矩阵；只把真实服务独有的风险放入 live lane。
