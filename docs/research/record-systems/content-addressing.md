# 内容寻址、schema 与 attestation

> 观察日期：2026-08-09
>
> 文档性质：外部产品研究与产品建议，不是 NiceEval 目标契约

## 研究判断

Git、OCI、IPLD 和 in-toto 共同证明了一条可行路线：稳定的小型引用外壳可以承载持续增加的领域对象。
它们也共同否定了更强的说法：内容寻址不会消除 schema，unknown payload 也不会自动变成可遍历对象。

NiceEval 最有辨识度的设计不是 digest，而是把 strong edge 放进所有 reader 都理解的 Graph node 外壳。
OCI 和 IPLD 通常要先理解 manifest schema 或 codec，才能发现对象的完整依赖。

## 一手材料

- [Git core data model](https://git-scm.com/docs/gitdatamodel)
- [Git repository format versions and extensions](https://git-scm.com/docs/gitrepository-layout)
- [Git SHA-256 transition plan](https://git-scm.com/docs/hash-function-transition)
- [OCI Content Descriptor](https://github.com/opencontainers/image-spec/blob/main/descriptor.md)
- [OCI Image Manifest](https://github.com/opencontainers/image-spec/blob/main/manifest.md)
- [OCI Image Layout](https://github.com/opencontainers/image-spec/blob/main/image-layout.md)
- [OCI Annotations](https://github.com/opencontainers/image-spec/blob/main/annotations.md)
- [IPLD: How IPLD works](https://ipld.io/docs/intro/hello-world/)
- [IPLD multicodec table](https://github.com/multiformats/multicodec)
- [IPFS persistence, pinning and garbage collection](https://docs.ipfs.tech/concepts/persistence/)
- [Software Heritage persistent identifiers](https://docs.softwareheritage.org/devel/swh-model/persistent-identifiers.html)
- [SWHID specification](https://www.swhid.org/specification/v1.2/)
- [Nix store objects](https://nix.dev/manual/nix/2.35/store/store-object)
- [Nix content addressing](https://nix.dev/manual/nix/2.35/store/store-object/content-address.html)
- [Bazel Remote Execution API](https://github.com/bazelbuild/remote-apis/blob/main/build/bazel/remote/execution/v2/remote_execution.proto)
- [in-toto Attestation Framework](https://github.com/in-toto/attestation/tree/main/spec)
- [in-toto Statement v1](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md)
- [SLSA Provenance](https://slsa.dev/spec/v1.2/provenance)
- [Sigstore bundle format](https://docs.sigstore.dev/about/bundle/)
- [Sigstore security model](https://docs.sigstore.dev/about/security/)

## 六组系统解决了什么

| 系统 | 相同问题 | 核心机制 | 与 NiceEval 的关键差异 |
|---|---|---|---|
| Git | 历史不可原地修改、对象复用、可变 head | 四种 immutable object、hash ID、mutable ref、reachability | object type 是封闭集合；不是任意 typed payload 平台 |
| OCI | typed blob、内容校验、跨 registry 搬运 | `mediaType + digest + size` Descriptor、manifest DAG | 依赖字段由具体 manifest schema 定义 |
| IPLD/IPFS | 跨 codec 内容身份和 DAG | CID、multicodec、codec 内 links、pin 与 GC | 不理解 codec 时可保存 block，却不能可靠发现 links |
| Software Heritage | 长期引用归档对象 | versioned SWHID 与内容图 | 面向源码归档的固定对象模型，不承担应用事务 |
| Nix/Bazel CAS | 构建对象去重、闭包传输和缓存回收 | Nix store references；Bazel opaque blobs 与 `GetTree` | Nix identity 绑定 store 语义；Bazel 的 typed tree 依赖固定 protobuf |
| in-toto/SLSA | 某主体由谁依据何种过程作出声明 | Statement、subject digest、`predicateType`、predicate、签名 envelope | attestation 是外部声明，不是 Record 内 Observation stream |

## Git：immutable object 不等于永不升级格式

Git object 创建后不会改变。
commit amend 会创建新 commit，branch ref 再指向它。
blob、tree、commit 和 annotated tag 是 core data model 的四种对象类型。

这给 Record 两个直接先例：

1. 历史 revision 通过不可变对象保留，latest 只是可变名字。
2. Projector 可以像 Git 计算 diff 一样，从固定对象重建读面，不必把所有派生结果落盘。

Git 也暴露了边界。
对象只有四种 core type，第三方不能仅注册新 type 就让旧 Git 完整遍历它。
repository format extension 和 SHA-256 transition 说明 object identity 的安全基础变化时，容器仍要升级。

Git 对旧对象的保存也不是永久承诺。
object 失去 ref 和 reflog 可达性后可以被 GC 删除。
NiceEval 若让每个 committed root 永久可重开，就选择了比 Git 更强也更昂贵的 retention 契约。

## OCI：Descriptor 是最直接的 frozen core 先例

OCI Descriptor 把 `mediaType`、`digest` 和 `size` 放在引用处。
consumer 可以在解释内容前校验字节身份和大小。
manifest 再用 Descriptor 引用 config、layer、子 manifest 或 artifact subject。

OCI 的扩展方式支持 Record 的总体方向：

- 新 layer compression 使用新的 media type，不给 descriptor 增加压缩字段。
- annotation 使用 namespace，consumer 遇到 unknown key 不能直接报错。
- artifact 通过新 manifest 语义组合既有 blob，而不是把所有领域字段加入 descriptor。

不过 OCI 没有 NiceEval strong edge 的完整保证。
依赖位置由 image manifest、image index 或 artifact manifest 的 schema 定义。
一个只理解 Descriptor、不理解未来 payload 的 copier 不一定知道 payload 里哪些引用必须跟随。

这说明 Record 把 edge page 与 opaque payload 分开确有额外价值。
它同时意味着每个领域 codec 必须准确声明全部强依赖；漏边会让 graph 表面可验证，实际却不完整。

## IPLD/IPFS：CID 解决身份，codec 解释链接

CID 同时携带内容 hash、multihash 和 codec identity。
同一 block 可以按 CID 保存、传输和去重，DAG traversal 则依赖 codec 解码 block 后发现 links。

遇到 unknown codec 时，节点仍可以作为 opaque bytes 保存。
但不知道 codec 的 generic implementation 无法断言自己已经发现全部 outgoing links。
这正是“unknown payload 可复制”和“unknown payload 的完整闭包可复制”之间的区别。

IPFS pin 与 GC 也提供一条现实边界。
内容寻址只决定对象是什么，不决定对象必须保留多久。
保留仍需要 pin 或其它 root；未受保护的 block 可以被回收。

NiceEval 的 committed root、staging、read lease 和 persistent pin 都是在回答 retention root。
digest 本身不能替代这些 owner。

## Software Heritage：长期 identifier 仍然有版本

Software Heritage 用 SWHID 标识 content、directory、revision、release、snapshot 等归档对象。
identifier 区分 core identifier version 和对象类型，context qualifier 再表达 origin、path 或 anchor。

它说明长期归档系统仍需要 identifier version。
“内容已经 hash”并不代表 identity grammar、对象类型和上下文解释从此冻结。

Software Heritage 的主要目标是归档和引用源码。
它不提供 NiceEval 所需的多 writer Record commit、evaluator basis、live view 或 partial receipt。
因此它只支持 identity 与长期寻址的局部类比。

## Nix 与 Bazel：有闭包和有 opaque blob 是两种能力

Nix store object 是不可变文件系统对象，references 形成有向图，requisites 是从对象出发可达的传递闭包。
这是 strong closure 的近似先例。
不过 Nix store path 的计算还绑定寻址方法、对象名称、store directory、序列化与 references；它不是中立的 typed payload identity。

Bazel Remote Execution CAS 的多数 binary data 对执行引擎是不透明 blob。
它的 `Digest` 只有 hash 与 `size_bytes`，hash algorithm 来自 instance capabilities 等外部上下文，也没有 media type。
当 digest 指向 `Directory` 等图对象时，`GetTree` 只能遍历这组已知 protobuf；其 canonical form 还明确禁止 unknown fields。

两者共同暴露了一个边界：

- Nix 有显式闭包，但对象 identity 和部署语义耦合得更紧。
- Bazel 能搬运 unknown bytes，但只有理解固定 `Directory` schema 才能遍历图。
- NiceEval 要组合 opaque payload、typed identity 和 parser-independent strong closure，因此写入时必须把所有保留相关依赖完整外置。

漏报 strong edge 是这项设计的新风险。
generic verifier 只能确认已声明闭包自洽，不能发现 payload 中本应声明却被遗漏的依赖；codec conformance 和领域验收仍不可省略。

## in-toto：Claim 最接近 attestation，而不是普通 event

in-toto Statement v1 把声明分成三部分：

```text
subject[]       被声明对象的名字与 digest
predicateType   这是什么种类的声明
predicate       该种声明自己的内容
```

Statement 可以再放入 DSSE 等签名 envelope。
SLSA Provenance 是其中一种 versioned predicate，包含 build definition、run details 和 builder identity。
它要求 consumer 忽略未识别字段，并把同一 major `predicateType` 下的 minor extension 限定为 monotonic：忽略扩展不能让本应拒绝的声明被接受。
破坏性语义变化仍要更换 major type。

这与 NiceEval Claim 的相似点很强：

- Claim 不把判断冒充 Observation。
- evaluator identity 类似 predicate producer 或 builder identity。
- basedOn 类似被声明的 subject 与 predicate 内的材料引用。
- 新 Claim 类型使用新 schema，而不是扩张 frozen graph core。

二者仍不相同。
in-toto Statement 通常对 artifact digest 作外部声明，签名和验证 policy 决定是否信任它。
NiceEval Claim 位于同一 Record 的领域历史中，并可引用 Observation、Provenance 或其它 Claim 作为 basis。

无论哪种模型，digest 都只证明目标 bytes 没变。
它不证明 producer 诚实、evaluator 正确，也不证明没有遗漏本应提供的证据。
Sigstore bundle 再把签名内容和 verification material 放进版本化 envelope；这支持 NiceEval 将 Claim bytes、producer authentication 和 verifier policy 分层，而不是把三者并入 frozen core。

## schema 承诺的可证伪边界

| 变化 | 外部先例 | NiceEval 的合理处理 |
|---|---|---|
| 新领域对象或 evaluator | OCI media type、in-toto `predicateType` | 新 typed payload 或 Claim schema |
| 新压缩或包装 | OCI layer media type | wrapper payload 与 strong edge |
| 新 hash algorithm | CID multihash、Git SHA-256 transition | registry 扩展；unknown algorithm 明确拒绝 |
| identity grammar 改变 | SWHID version、Git repository format | core 或 identifier version 升级 |
| 引用语义改变 | manifest/codec schema version | 新 payload media type；必要时 core 升级 |
| producer authenticity | signed attestation、Sigstore | 独立 receipt、signature 或 trusted channel |

这张表支持“多数新能力不改 frozen core”，不支持“以后不用改 schema”。
领域 schema、identifier registry 和 core security interpretation 是三个不同的升级面。

## 值得吸收

1. 保留 OCI 式完整 typed reference，校验发生在 payload decode 之前。
2. 像 in-toto 一样让 Claim type 和 evaluator identity 显式可版本化。
3. 像 IPFS pin 和 Git ref 一样，把 retention owner 与 content identity 分开。
4. 为 digest algorithm 和 media type 建立 registry，但 unknown 项返回局部 unsupported。
5. 让普通用户只接触领域动作；Git porcelain 与 plumbing 的分层同样适用于 Record API。
6. 借鉴 SLSA 的 monotonic extension 规则：旧 reader 忽略新字段时不得把拒绝变成接受。

## 不应复制

- 不采用 Git 的封闭 object type 集合承载所有 Eval 领域对象。
- 不假定 OCI Descriptor 本身能让 generic walker 发现未来 manifest 的全部依赖。
- 不把 CID 或 digest 当成 authenticity、completeness 或 retention proof。
- 不允许 arbitrary annotation 承担 identity、权限、strong dependency 或判断语义。
- 不把 signed Claim 描述成真相；签名只能回答谁签了哪些 bytes。
- 不把 Bazel 的 opaque blob 或 IPLD 的 unknown block 描述成已验证的完整依赖闭包。

## 对上层 API 的启发

Git 的日常用户使用 add、commit、branch 和 log，不手写 object header 或 packfile。
OCI 用户通常通过 build、push、pull 和 artifact attach 操作，也不逐个拼 Descriptor。

NiceEval 也应把 storage plumbing 留在 advanced 边界。
Eval 作者调用 assertion 或 judge，Adapter 作者使用已绑定的 typed emitter，框架再生成 payload、Node、edge、catalog 和 CAS revision。

只有协议扩展作者需要通用 payload registration 和底层 writer。
即使在 advanced API 中，也不能允许调用方绕过 codec 偷藏未声明的强依赖。
