# `DiffView`

文件清单与可展开 patch：一行一个文件，展开看这个文件的改动。

```tsx
<DiffView source={sources.attempt.diff} />
```

## 形状

```ts
interface DiffFile {
  path: string;
  change: "generated" | "modified" | "deleted";
  added: number;
  removed: number;
  /** 统一 diff 正文；缺失时行照常出现，展开区如实说明拿不到正文。 */
  patch?: string;
}

type DiffContent = readonly DiffFile[];

type DiffViewProps = DataProps<AttemptEvidence, DiffContent | null> & {
  locale?: ReportLocale;
  className?: string;
};
```

## 渲染

- web 面：文件清单按 `change` 分组，组内按路径字典序；每个文件用原生 `<details>` 展开 patch，
  增删行分色，行号两栏。
- text 面：文件摘要（路径、类别、`+N / -M`）加 `--diff` 命令，不倾倒 patch 正文。
- 没有变更事实时两面零输出，不渲染空容器。

## 相关阅读

- [组件树](../README.md) —— 四层模型与双面投影边界。
- [数据源目录](../sources/README.md) —— 变更事实的数据源。
