# Fixture 内容 action —— Library

## 导出

```ts
import {
  changeFrequency,
  sandboxContent,
  uploadDirectory,
  uploadFile,
} from "niceeval/sandbox";
```

## Agent 前内容

```ts
interface UploadActionInput {
  readonly id: string;
  readonly source: string | URL;
  readonly to: string;
  readonly changeFrequency?: number;
  readonly dependsOn?: readonly SandboxActionRef[];
}

declare function uploadFile(input: UploadActionInput): SandboxAction;
declare function uploadDirectory(input: UploadActionInput): SandboxAction;
```

`source` 使用 `file:` URL 时绑定定义模块；项目根内字符串按项目根定位。目录 action 生成包含相对路径、节点类型、模式与文件 digest 的规范化 manifest。符号链接越出声明根、目标路径非法或内容在读取期间变化时，planning 在 Provider I/O 前失败。

```ts
export default defineExperiment({
  agent: codexAgent(),
  sandbox: e2bSandbox({ template: "niceeval-agents" }).before(uploadFile({
    id: "mempal-config",
    source: new URL("./fixtures/mempal.json", import.meta.url),
    to: "/etc/niceeval/mempal.json",
    changeFrequency: 40,
  })),
});
```

字段所在的 Eval、Experiment、Group、Agent 或 NiceEval Plugin 决定 owner。API 不根据目录名猜 owner。

## Agent 后内容

```ts
interface SandboxContent {
  readonly digest: string;
  readonly kind: "file" | "directory";
}

declare const sandboxContent: {
  file(source: string | URL): SandboxContent;
  directory(source: string | URL): SandboxContent;
};
```

`sandboxContent.*()` 只登记内容，不产生 Sandbox action。Eval test 使用 `t.sandbox.upload(content, target)` 决定真实可见时点。
