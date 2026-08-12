# OpenAI Evals 与 Graders 作者指南

> 观察日期：2026-08-09。
>
> 本文研究 OpenAI 托管 Evals API 与 Graders API 的公开作者面。
> 它不是 NiceEval 产品契约，也不是 OpenAI 新项目选型建议。

## 1. 定位与真实边界

**官方事实。** OpenAI Evals 是托管的异步批量评估服务。
作者先创建带数据 schema 和 `testing_criteria` 的 Eval，再创建 Run。
Run 可以调用模型生成 `sample`，也可以对预先算好的 `sample` 判分。
每行结果汇成 Run 统计，并可在 Dashboard 中查看。
[Evals 指南](https://developers.openai.com/api/docs/guides/evals)给出了这条流程。

**官方事实。** Graders 是 JSON 判别联合。
它把 `item` 中的参考信息与 `sample` 中的模型回答映射到数值 grade。
指南把通常范围描述为 `0..1`，但 Score Model 可设 `range`，`multi` 也可用公式合成。
`validate` 检查 grader 配置，`run` 用一个样本执行 grader。
这两个端点位于 `/v1/fine_tuning/alpha/graders/*`。
[Graders API reference](https://developers.openai.com/api/reference/resources/graders)把它列在 Fine Tuning 的 Alpha 区域。

**官方事实。** Evals 已是 Legacy 产品。
OpenAI 于 2026-06-03 宣布退役计划。
既有 Eval 将在 2026-10-31 变成只读，平台计划于 2026-11-30 关闭。
[退役公告](https://developers.openai.com/api/docs/deprecations#2026-06-03-evals-platform)是时间线的权威页面。
OpenAI 建议交互式新任务先用 Datasets，并为持续评估推荐 Promptfoo 迁移路径。

Eval workflow 中的 graders 随 Evals 一起迁移。
Fine-tuning grader 则服从 self-serve fine-tuning 时间线。
该时间线已限制新组织与不活跃组织建 job，活跃既有客户也将在 2027-01-06 失去新建 job 能力。
公告没有单列 Standalone grader 端点的关闭日期。

Datasets Dashboard 提供五种非 `multi` grader：字符串、文本相似度、Score Model、Label Model 与 Python。
作者可对同一数据集保存多个 grader，并逐个或全部执行。
观察到的 Datasets 指南只给 Dashboard 流程，没有公开 Datasets HTTP API。

**研究判断。** 这套作者面不是通用断言运行时。
公开模板只有 `item` 与 `sample`，没有 run、turn、文件系统或 Sandbox 作用域。
它擅长“一个数据行、一个模型样本、一个或多个 grader”的托管评估。
它不直接表达应用状态迁移、资源生命周期或多步旅程断言。

历史上的开源 OpenAI Evals registry 与本文的托管 `/v1/evals` 不是同一作者面。
观察日的现行 API 文档没有把 registry schema 纳入 HTTP 契约。
本文不会把旧 registry 的 YAML、eval class 或组合规则混入当前 API catalog。

## 2. 观察快照与一手链接

官方页面是滚动发布页面，没有展示文档 commit 或整体语义版本。
因此本文固定观察日期、端点路径、枚举值和可固定的局部版本。
除明确写出“研究判断”的段落外，catalog 陈述均来自下表的一手材料。

| 一手材料 | 本文据此确认的事实 | 观察日状态 |
| --- | --- | --- |
| [Evals 指南](https://developers.openai.com/api/docs/guides/evals) | 创建 Eval、上传 JSONL、创建异步 Run、查询结果 | Legacy，页面含关闭提示 |
| [Evals API reference](https://developers.openai.com/api/reference/resources/evals) | 全部 Eval、Run、output item 端点与对象 schema | 路径仍公开 |
| [Graders 指南](https://developers.openai.com/api/docs/guides/graders) | 模板、算法语义、Python 限制、`multi` 公式 | 页面含退役提示 |
| [Graders API reference](https://developers.openai.com/api/reference/resources/graders) | 六种 grader 判别联合与字段 | Fine Tuning / Alpha |
| [Run grader](https://developers.openai.com/api/reference/resources/fine_tuning/subresources/alpha/subresources/graders/methods/run) | `run` 请求、返回值与诊断 flags | Fine Tuning / Alpha 路径 |
| [Validate grader](https://developers.openai.com/api/reference/resources/fine_tuning/subresources/alpha/subresources/graders/methods/validate) | `validate` 请求与返回值 | Fine Tuning / Alpha 路径 |
| [Datasets 入门](https://developers.openai.com/api/docs/guides/evaluation-getting-started) | 新作者入口、Dashboard grader 列表 | OpenAI 推荐的交互式入口 |
| [评估最佳实践](https://developers.openai.com/api/docs/guides/evaluation-best-practices) | 持续评估、人工校准、比较式任务 | 方法指南 |
| [Evals 迁移到 Promptfoo](https://developers.openai.com/cookbook/examples/evaluation/moving-from-openai-evals-to-promptfoo) | 可运行配置与历史结果分开导出 | OpenAI 推荐的持续路径 |
| [开发者快速入门](https://developers.openai.com/api/docs/quickstart) | SDK 安装与 `OPENAI_API_KEY` 读取方式 | JavaScript 示例使用 `openai` 包 |

可固定的执行版本只有 Python grader 的 `image_tag: "2025-05-08"`。
该镜像的包版本见[Graders 指南的 Python 小节](https://developers.openai.com/api/docs/guides/graders#python-graders)。
SDK 安装命令没有固定包版本，模型示例也会随页面更新。

## 3. 安装、最小项目与首个可运行 Eval

这段示例沿用官方 JavaScript SDK 与 Evals 指南的对象形状。
它会创建远端 Eval、上传文件并产生模型调用费用。
只应在仍有 Evals 写权限的项目中执行。

### 3.1 建立项目

```bash
mkdir openai-evals-smoke
cd openai-evals-smoke
npm init -y
npm install openai
export OPENAI_API_KEY="your_api_key_here"
```

SDK 会自动读取 `OPENAI_API_KEY`。
把以下三行保存为 `tickets.jsonl`：

```jsonl
{ "item": { "ticket_text": "My monitor won't turn on!", "correct_label": "Hardware" } }
{ "item": { "ticket_text": "I'm in vim and I can't quit!", "correct_label": "Software" } }
{ "item": { "ticket_text": "Best restaurants in Cleveland?", "correct_label": "Other" } }
```

### 3.2 创建 Eval、上传数据并启动 Run

把下面内容保存为 `eval.mjs`：

```javascript
import fs from "node:fs";
import OpenAI from "openai";

const openai = new OpenAI();

const evalObj = await openai.evals.create({
  name: "IT Ticket Categorization",
  data_source_config: {
    type: "custom",
    item_schema: {
      type: "object",
      properties: {
        ticket_text: { type: "string" },
        correct_label: { type: "string" },
      },
      required: ["ticket_text", "correct_label"],
    },
    include_sample_schema: true,
  },
  testing_criteria: [
    {
      type: "string_check",
      name: "Match output to human label",
      input: "{{ sample.output_text }}",
      operation: "eq",
      reference: "{{ item.correct_label }}",
    },
  ],
});

const file = await openai.files.create({
  file: fs.createReadStream("tickets.jsonl"),
  purpose: "evals",
});

let run = await openai.evals.runs.create(evalObj.id, {
  name: "Categorization text run",
  data_source: {
    type: "responses",
    model: "gpt-5.6",
    input_messages: {
      type: "template",
      template: [
        {
          role: "developer",
          content:
            "Categorize the IT ticket as Hardware, Software, or Other. Return only that word.",
        },
        { role: "user", content: "{{ item.ticket_text }}" },
      ],
    },
    source: { type: "file_id", id: file.id },
  },
});

while (["queued", "in_progress"].includes(run.status)) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  run = await openai.evals.runs.retrieve(run.id, { eval_id: evalObj.id });
}

console.log({
  eval_id: evalObj.id,
  run_id: run.id,
  status: run.status,
  counts: run.result_counts,
  report_url: run.report_url,
});
```

执行：

```bash
node eval.mjs
```

`runs.create` 先返回 `queued` Run，所以示例轮询到终态。
终态集合是 `completed`、`failed` 或 `canceled`。
成功 Run 的 `result_counts` 分成 `passed`、`failed`、`errored` 与 `total`。
这些形状来自[Evals API reference](https://developers.openai.com/api/reference/resources/evals)。

## 4. 核心数据流与对象关系

```text
Eval(data_source_config, testing_criteria)
  └─ Run(data_source, model/prompt 或预先算好的 sample)
       ├─ row.item ───────────────┐
       ├─ row.sample ─────────────┼─> grader(s) -> score / pass / error
       └─ output item <───────────┘
            └─ Run 汇总：counts、每项 criterion、token usage、report_url
```

| 对象 | 作者提供什么 | 服务补什么 | 生命周期 |
| --- | --- | --- | --- |
| Eval | 数据 schema、grader 列表、名称、metadata | Eval ID 与 criterion ID | 创建后只能改名称和 metadata |
| Run | 数据入口、模型、prompt、采样配置 | 排队、逐行采样、判分与统计 | 异步，可查询、取消、删除 |
| `item` | 测试输入与参考值 | 按数据行注入模板 | 每行一个 |
| `sample` | 可由 JSONL 直接给出 | 也可由 Completions 或 Responses 生成 | 每行一个模型样本 |
| grader | 一个判别联合成员 | 执行算法或 Judge | 每个 criterion 独立产生结果 |
| output item | 无 | 保存该行输入、样本、criterion 结果与错误 | 可分页读取或按 ID 读取 |

Standalone `validate` 与 `run` 不创建 Eval 或批量 Run。
它们是同步 HTTP 调用，适合在接入批量流程前检查一个 grader。
Evals Run 则是远端异步任务。

## 5. 完整 API catalog

### 5.1 模板变量

任何 grader 字符串中的 `{{ ... }}` 都会做变量替换。
括号内必须是 `namespace.variable`，嵌套字段使用 JSON path 风格。
官方只列出两个 namespace。

| namespace / 变量 | 类型与含义 | 何时存在 |
| --- | --- | --- |
| `item.*` | Eval 数据行或 fine-tuning 数据行中的任意字段 | 调用者提供对应字段时 |
| `sample.output_text` | 模型文本，字符串 | 模型产生文本或 `model_sample` 提供文本时 |
| `sample.output_json` | 模型文本对应的 JSON 对象 | 指南要求 sample 带 `response_format` |
| `sample.output_tools` | Chat Completions `tool_calls` 同形数组 | 样本含工具调用时 |
| `sample.choices` | Chat Completions `choices` 同形数组 | 该采样面提供 choices 时 |
| `sample.output_audio` | 含 Base64 `data` 与 `transcript` 的对象 | 样本含音频输出时 |

[Graders 指南的 Templating 小节](https://developers.openai.com/api/docs/guides/graders#templating)给出这些变量。
Standalone `run` reference 另称：合法 JSON 字符串会填入 `output_json`。
两种启用条件不完全一致，本文在第 12 节保留这项差异。

模板不会获得 Eval Run、对话轮次、宿主进程或 Sandbox 对象。
字段不存在时也没有官方的“跳过此 grader”语法。

### 5.2 六种 grader 判别联合

当前 `Grader` 联合可以写成：

```ts
type Grader =
  | StringCheckGrader
  | TextSimilarityGrader
  | ScoreModelGrader
  | LabelModelGrader
  | PythonGrader
  | MultiGrader;
```

| `type` | Standalone `grader` | Evals `testing_criteria` | 直接结果 |
| --- | --- | --- | --- |
| `string_check` | 是 | 是 | 二元 `0` 或 `1` |
| `text_similarity` | 是 | 是，另需 `pass_threshold` | 连续 `0..1` |
| `score_model` | 是 | 是，可加 `pass_threshold` | `range` 内数值 |
| `label_model` | 是 | 是 | 模型选 label；`passing_labels` 定义通过 |
| `python` | 是 | 是，可加 `pass_threshold` | `grade()` 返回的 float |
| `multi` | 是，API union 列出 | 否 | 公式合成的数值；产品用途限 RFT |

Standalone 对象都要求 `name`。
指南中的少数 Python 与 `multi` 片段省略了 `name`，但当前 API reference 把它列为必填。
下面以 reference 为准。

#### `string_check`

```ts
type StringCheckGrader = {
  type: "string_check";
  name: string;
  input: string;
  reference: string;
  operation: "eq" | "ne" | "like" | "ilike";
};
```

`eq` 与 `ne` 做区分大小写的相等或不相等比较。
`like` 与 `ilike` 检查 `input` 是否包含 `reference`，后者不区分大小写。
匹配返回 `1`，否则返回 `0`。
指南正文把不相等写成 `neq`，但 schema 与 API reference 均写 `ne`；请求应使用 `ne`。

该类型没有 threshold、容差、trim 或正规化参数。
模板缺失、类型错误和服务错误没有类型专属的 skip 值。

#### `text_similarity`

```ts
type TextSimilarityGrader = {
  type: "text_similarity";
  name: string;
  input: string;
  reference: string;
  evaluation_metric:
    | "fuzzy_match" | "bleu" | "gleu" | "meteor" | "cosine"
    | "rouge_1" | "rouge_2" | "rouge_3" | "rouge_4" | "rouge_5" | "rouge_l";
};
```

`fuzzy_match` 使用 RapidFuzz。
`bleu`、`gleu`、`meteor` 与六个 ROUGE 变体使用各自同名文本指标。
`cosine` 用 `text-embedding-3-large`，且只在 Evals 可用。
各指标返回 `0..1`。

Standalone 对象没有 `pass_threshold`。
作为 Evals criterion 时，`pass_threshold: number` 是必填扩展字段。
达到 threshold 才算 pass；reference 没有声明默认值。

#### `score_model`

```ts
type ScoreModelGrader = {
  type: "score_model";
  name: string;
  input: GraderMessage[];
  model: string;
  range?: number[];                 // 默认 [0, 1]
  sampling_params?: {
    seed?: number | null;
    top_p?: number | null;
    temperature?: number | null;
    max_completions_tokens?: number | null;
    reasoning_effort?:
      | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
      | null;
  };
};
```

`input` 是 Judge 的消息列表。
消息角色可为 `system`、`developer`、`user` 或 `assistant`，`type?: "message"`。
`content` 可为字符串、单个 content block 或 block 数组。

完整 grader content block 集合是 `input_text`、`output_text`、`input_image` 与 `input_audio`。
图片使用 `image_url`，`detail` 可为 `high`、`low`、`auto`，默认 `auto`。
音频使用 Base64 `data`，格式只能是 `mp3` 或 `wav`。
`input_text` 还可带 `{ prompt_cache_breakpoint: { mode: "explicit" } }`。

服务要求 Judge 输出结构化对象：

```ts
type ScoreModelOutput = {
  result: number;
  steps: Array<{ description: string; conclusion: string }>;
};
```

最终 grade 会被截到 `range` 内，`range` 默认 `[0, 1]`。
非数字输出得到 `0`。
Evals criterion 可以另带 `pass_threshold?: number`，reference 没有给该字段默认值。

推理模型不支持修改 `temperature`，非推理模型不支持 `reasoning_effort`。
并非每个推理模型都支持全部 effort 值。
当前 reference 示例使用 `gpt-5-mini`，指南却列出一组较早的固定快照。
因此模型可用性应在目标项目调用 `validate` 与 `run` 实测。

指南声称只支持以下九个 Judge 快照：

| 系列 | 指南中的完整模型 ID |
| --- | --- |
| GPT-4o | `gpt-4o-2024-08-06`、`gpt-4o-mini-2024-07-18` |
| GPT-4.1 | `gpt-4.1-2025-04-14`、`gpt-4.1-mini-2025-04-14`、`gpt-4.1-nano-2025-04-14` |
| o 系列 | `o1-2024-12-17`、`o3-mini-2025-01-31`、`o3-2025-04-16`、`o4-mini-2025-04-16` |

`max_completions_tokens` 的公开最小值是 `1`。
滚动 reference 已扩展 effort 枚举和示例模型，所以这张表只能视为指南快照。

#### `label_model`

```ts
type LabelModelGrader = {
  type: "label_model";
  name: string;
  input: GraderMessage[];
  model: string;                    // 必须支持 Structured Outputs
  labels: string[];
  passing_labels: string[];         // 必须是 labels 的子集
};
```

消息和多模态 content block 与 `score_model` 相同。
Judge 从 `labels` 选一个标签，命中 `passing_labels` 才算通过。
官方没有说明 Standalone `reward` 如何把各 label 映射到数值。
也没有“无法选择”或无分标签的独立协议。

#### `python`

```ts
type PythonGrader = {
  type: "python";
  name: string;
  source: string;
  image_tag?: string;
};
```

`source` 必须恰好提供 `grade(sample, item) -> float`。
异常、非 float 或无效返回会标为 invalid，并得到 `0`。
`sample` 可含 `choices`、`output_text`、`output_json`、`output_tools` 与 `output_audio`。
`item` 含输入数据行的字段。

代码必须小于 256 kB，不能访问网络。
单次执行上限是 2 分钟、2 GB 内存、1 GB 磁盘和 2 个 CPU core。
超过 CPU 配额会被限速。

`image_tag: "2025-05-08"` 提供以下固定包：

| 包 | 版本 | 包 | 版本 |
| --- | --- | --- | --- |
| numpy | 2.2.4 | scipy | 1.15.2 |
| sympy | 1.13.3 | pandas | 2.2.3 |
| rapidfuzz | 3.10.1 | scikit-learn | 1.6.1 |
| rouge-score | 0.1.2 | deepdiff | 8.4.2 |
| jsonschema | 4.23.0 | pydantic | 2.10.6 |
| pyyaml | 6.0.2 | nltk | 3.9.1 |
| sqlparse | 0.5.3 | rdkit | 2024.9.6 |
| scikit-bio | 0.6.3 | ast-grep-py | 0.36.2 |

可用 NLTK corpus 是 `punkt`、`stopwords`、`wordnet`、`omw-1.4` 与 `names`。
官方没有声明省略 `image_tag` 时会选择哪个镜像。

#### `multi`

```ts
type MultiGrader = {
  type: "multi";
  name: string;
  graders: Record<string,
    StringCheckGrader | TextSimilarityGrader | PythonGrader |
    ScoreModelGrader | LabelModelGrader>;
  calculate_output: string;
};
```

公式变量是 `graders` 的键。
运算符完整集合是 `+`、`-`、`*`、`/`、`^`。
函数完整集合是 `min`、`max`、`abs`、`floor`、`ceil`、`exp`、`sqrt` 与 `log`。
`multi` 不能嵌套另一个 `multi`。

官方指南明确说 `multi` 只用于 Reinforcement fine-tuning。
Evals 的 `testing_criteria` 联合也没有 `multi`。
API reference 的旧示例把 `graders` 画成数组，且公式变量不是 grader 名称。
第 6.3 节采用较新的指南对象形状，并要求先调用 `validate`。

### 5.3 Standalone Graders API

两个请求都是普通同步 HTTP 调用，没有 job ID、轮询或取消端点。

| 方法 | 请求 | 返回 | 失败与无分语义 |
| --- | --- | --- | --- |
| `POST /fine_tuning/alpha/graders/validate` | `{ grader: Grader }` | `{ grader: Grader }` | 配置无效时请求失败；不执行样本 |
| `POST /fine_tuning/alpha/graders/run` | `{ grader, model_sample: string, item?: object }` | `GraderRunResult` | HTTP 错误或返回中的诊断 flags；没有 skip 状态 |

`model_sample` 会填入 `sample` namespace，`item` 会填入 `item` namespace。
`run` 的完整成功结果是：

```ts
type GraderRunResult = {
  reward: number;
  metadata: {
    name: string;
    type: string;
    execution_time: number;
    sampled_model_name: string | null;
    scores: Record<string, unknown>;
    token_usage: TokenUsage | null;
    errors: {
      formula_parse_error: boolean;
      invalid_variable_error: boolean;
      model_grader_parse_error: boolean;
      model_grader_refusal_error: boolean;
      model_grader_server_error: boolean;
      model_grader_server_error_details: string | null;
      other_error: boolean;
      python_grader_runtime_error: boolean;
      python_grader_runtime_error_details: string | null;
      python_grader_server_error: boolean;
      python_grader_server_error_type: string | null;
      sample_parse_error: boolean;
      truncated_observation_error: boolean;
      unresponsive_reward_error: boolean;
    };
  };
  sub_rewards: Record<string, number>;
  model_grader_token_usage_per_model: Record<string, TokenUsage>;
};

type TokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_tokens: number;
};
```

`reward` 是合成后的 grade，`sub_rewards` 是 `multi` 的子分。
`metadata.scores` 是额外分数字典。
Judge 调用的 token 统计同时按本次调用与模型给出。
错误 flags 把公式、变量、样本、Python 与 Judge 故障分开。

官方没有定义统一的“错误时 reward 必为多少”。
只有 Python invalid 与 Score Model 非数字明确得到 `0`。
调用者不能只看 `reward`，还应检查所有 `metadata.errors`。

### 5.4 Evals 定义 API

创建 Eval 的请求签名是：

```ts
type CreateEvalRequest = {
  name?: string;
  metadata?: Record<string, string> | null;
  data_source_config:
    | { type: "custom"; item_schema: object; include_sample_schema?: boolean }
    | { type: "logs"; metadata?: Record<string, string> }
    | { type: "stored_completions"; metadata?: Record<string, string> };
  testing_criteria: Array<
    LabelModelGrader | StringCheckGrader | EvalTextSimilarityGrader |
    EvalPythonGrader | EvalScoreModelGrader
  >;
};
```

`stored_completions` 已标成 deprecated，应改用 `logs`。
`custom.item_schema` 是数据行的 JSON Schema。
grader 引用 `sample.*` 时，指南要求 `include_sample_schema: true`。
API reference 没有声明该布尔值的默认值。

Evals 对三类 grader 增加 pass 字段：

```ts
type EvalTextSimilarityGrader = TextSimilarityGrader & {
  pass_threshold: number;
};
type EvalPythonGrader = PythonGrader & {
  pass_threshold?: number;
};
type EvalScoreModelGrader = ScoreModelGrader & {
  pass_threshold?: number;
};
```

`label_model` 用 `passing_labels`，`string_check` 本身就是二元结果。
Python 与 Score Model 省略 threshold 时如何形成 pass，reference 没有说明。

metadata 最多 16 个键值对。
键最长 64 字符，值最长 512 字符。

| 方法 | 可写参数 | 返回与默认值 | 同步性 |
| --- | --- | --- | --- |
| `POST /evals` | 上述 `CreateEvalRequest` | `Eval`；可选字段无公开默认值 | 同步创建 |
| `GET /evals/{eval_id}` | path ID | 一个 `Eval` | 同步读取 |
| `GET /evals` | `after`、`limit=20`、`order=asc|desc`、`order_by=created_at|updated_at` | 分页 Eval 列表；后两项默认 `asc`、`created_at` | 同步读取 |
| `POST /evals/{eval_id}` | 仅 `name`、`metadata` | 更新后的 `Eval` | 同步更新 |
| `DELETE /evals/{eval_id}` | path ID | `{ object, deleted, eval_id }` | 同步删除 |

`Eval` 返回 `id`、`object: "eval"`、`created_at`、名称、metadata、数据 schema 与 criterion 列表。
服务还会为 criterion 分配 ID。

### 5.5 Run 数据入口

Run 需要 `data_source`，可选 `name` 与 metadata。
三种判别分支如下。

| `data_source.type` | `source` | 是否调用模型 | 其余作者字段 |
| --- | --- | --- | --- |
| `jsonl` | `file_id` 或内联 `file_content` | 否，行内可给 `sample` | 每行 `{ item, sample? }` |
| `completions` | 文件、内联内容或过滤 `stored_completions` | 可选 | `input_messages`、`model`、`sampling_params` |
| `responses` | 文件、内联内容或过滤既有 Responses | 可选 | `input_messages`、`model`、`sampling_params` |

`input_messages` 有两个分支。
`template` 接收消息数组，可在消息中引用 `{{item.*}}`。
`item_reference` 接收类似 `item.input_trajectory` 的字段路径。

Completions 采样参数是 `max_completion_tokens`、`reasoning_effort`、`response_format`、
`seed`、`temperature`、`tools` 与 `top_p`。
Responses 分支把结构化文本配置放在 `text.format`，其余相关字段是
`max_completion_tokens`、`reasoning_effort`、`seed`、`temperature`、`tools` 与 `top_p`。

文件或内联行填入 `item`。
`stored_completions` source 的筛选字段完整集合是 `created_after`、`created_before`、
`limit`、metadata 与 model。
Responses source 的筛选字段完整集合是 `created_after`、`created_before`、
`instructions_search`、metadata、model、`reasoning_effort`、`temperature`、tools、`top_p` 与 users。
字段类型与各分支差异见
[Create eval run reference](https://developers.openai.com/api/reference/resources/evals/subresources/runs/methods/create)。

### 5.6 Run 与 output item API

| 方法 | 参数与默认值 | 返回 | 同步性 |
| --- | --- | --- | --- |
| `POST /evals/{eval_id}/runs` | `{ data_source, name?, metadata? }` | 初始 `EvalRun`，常为 `queued` | 异步任务入口 |
| `GET /evals/{eval_id}/runs/{run_id}` | 两个 path ID | 最新 `EvalRun` | 同步读取 |
| `GET /evals/{eval_id}/runs` | `after`、`limit=20`、`order=asc|desc`、`status?` | 分页 Run 列表；order 默认 `asc` | 同步读取 |
| `POST /evals/{eval_id}/runs/{run_id}` | 两个 path ID | 取消后的 `EvalRun` | 同步发起取消 |
| `DELETE /evals/{eval_id}/runs/{run_id}` | 两个 path ID | `{ object, deleted, run_id }` | 同步删除 |
| `GET /evals/{eval_id}/runs/{run_id}/output_items` | `after`、`limit=20`、`order=asc|desc`、`status?` | 分页 output item；order 默认 `asc` | 同步读取 |
| `GET /evals/{eval_id}/runs/{run_id}/output_items/{output_item_id}` | Eval、Run、item 三个 ID | 一个 output item | 同步读取 |

Run 状态枚举是 `queued`、`in_progress`、`completed`、`failed` 与 `canceled`。
列表可按这五个值筛选。

`EvalRun` 的判分相关返回形状是：

```ts
type EvalRun = {
  id: string;
  eval_id: string;
  object: "eval.run";
  created_at: number;
  name: string;
  metadata: Record<string, string> | null;
  status: "queued" | "in_progress" | "completed" | "failed" | "canceled";
  model: string;
  data_source: RunDataSource;
  error: { code: string; message: string } | null;
  report_url: string;
  result_counts: { total: number; passed: number; failed: number; errored: number };
  per_model_usage: Array<{
    model_name: string;
    invocation_count: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_tokens: number;
  }> | null;
  per_testing_criteria_results: Array<{
    testing_criteria: string;
    passed: number;
    failed: number;
  }> | null;
};
```

API schema 把 usage 与 criterion 数组写成数组，排队示例则返回 `null`。
上面的联合保留了两种公开形状。

output item 列表的 status 查询 schema 枚举写作 `fail | pass`。
同页说明文字却让调用者用 `failed | pass` 筛选。
这是官方页面自身的不一致，客户端应以实际 reference 或 SDK 类型再核对。

分页对象含 `data`、`first_id`、`last_id`、`has_more` 与 `object: "list"`。
output item 本体含 `id`、时间、三个关联 ID、status、数据行 ID、数据行、`sample` 与 `results`。

每个 criterion 结果的核心形状是：

```ts
type EvalRunOutputItem = {
  id: string;
  eval_id: string;
  run_id: string;
  object: "eval.run.output_item";
  created_at: number;
  datasource_item_id: number;
  datasource_item: Record<string, unknown>;
  status: string; // 列表筛选 schema 列出 fail 与 pass
  results: Array<{
    name: string;
    passed: boolean;
    score: number;
    type?: string;
    sample?: Record<string, unknown> | null;
  }>;
  sample: {
    error: { code: string; message: string } | null;
    finish_reason: string;
    input: Array<{ role: string; content: string }>;
    output: Array<{ role?: string; content?: string }>;
    model: string;
    max_completion_tokens: number;
    seed: number;
    temperature: number;
    top_p: number;
    usage: TokenUsage;
  };
};
```

公开对象没有 `skipped`、`unavailable` 或 `no_score` 状态。
Run 级故障进入 `error` 或 `result_counts.errored`。
逐项判定则是 pass 或 fail，具体 grader 也可能把无效输出压成 `0`。

## 6. 可抄的完整场景

以下请求都需要 `OPENAI_API_KEY`。
它们会调用远端服务，Judge 场景还会产生模型费用。

### 6.1 确定性检查：先 validate，再执行一个样本

先检查 schema：

```bash
curl https://api.openai.com/v1/fine_tuning/alpha/graders/validate \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "grader": {
      "type": "string_check",
      "name": "ticket label",
      "input": "{{sample.output_text}}",
      "reference": "{{item.label}}",
      "operation": "eq"
    }
  }'
```

再执行：

```bash
curl https://api.openai.com/v1/fine_tuning/alpha/graders/run \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "grader": {
      "type": "string_check",
      "name": "ticket label",
      "input": "{{sample.output_text}}",
      "reference": "{{item.label}}",
      "operation": "eq"
    },
    "item": { "label": "Hardware" },
    "model_sample": "Hardware"
  }'
```

这个样本应得到 `reward: 1`。
`validate` 只证明配置可接受；第二个请求才证明变量替换与执行结果。

### 6.2 开放式 Judge：按明确 rubric 给连续分

请求形状与模型名取自官方
[Run grader 示例](https://developers.openai.com/api/reference/resources/fine_tuning/subresources/alpha/subresources/graders/methods/run)。
任务 rubric 是本文为可抄性补充的应用内容，不代表 OpenAI 默认标准。

```bash
curl https://api.openai.com/v1/fine_tuning/alpha/graders/run \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "grader": {
      "type": "score_model",
      "name": "factual support",
      "input": [
        {
          "role": "developer",
          "content": "Return result 1 only when every claim is supported by the reference. Return 0.5 for a supported core answer with a minor omission. Return 0 for any contradiction. Explain the choice in steps."
        },
        {
          "role": "user",
          "content": "Reference: {{item.reference_answer}}\nAnswer: {{sample.output_text}}"
        }
      ],
      "model": "gpt-5-mini",
      "range": [0, 1],
      "sampling_params": {
        "temperature": 1,
        "top_p": 1,
        "seed": 42
      }
    },
    "item": {
      "reference_answer": "The support desk is open Monday through Friday."
    },
    "model_sample": "The support desk is open on weekdays."
  }'
```

不要只读取 `reward`。
还要检查 `model_grader_parse_error`、`model_grader_refusal_error`、
`model_grader_server_error` 与 `sampled_model_name`。
对生产阈值，应先用人工标注样本校准 Judge 排序。

### 6.3 组合与聚合：JSON 字段的 `multi` grader

这是[Combined graders 指南](https://developers.openai.com/api/docs/guides/graders#combined-graders)的完整对象形状。
它只属于 Reinforcement fine-tuning，不可放进 Evals `testing_criteria`。
先用 `validate` 检查目标项目接受的 `graders` 形状。

```bash
curl https://api.openai.com/v1/fine_tuning/alpha/graders/validate \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "grader": {
      "type": "multi",
      "name": "contact fields",
      "graders": {
        "name": {
          "type": "text_similarity",
          "name": "name similarity",
          "input": "{{sample.output_json.name}}",
          "reference": "{{item.name}}",
          "evaluation_metric": "fuzzy_match"
        },
        "email": {
          "type": "string_check",
          "name": "email equality",
          "input": "{{sample.output_json.email}}",
          "reference": "{{item.email}}",
          "operation": "eq"
        }
      },
      "calculate_output": "(name + email) / 2"
    }
  }'
```

若 `validate` 返回相同 grader，再执行完整的单样本请求：

```bash
curl https://api.openai.com/v1/fine_tuning/alpha/graders/run \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "grader": {
      "type": "multi",
      "name": "contact fields",
      "graders": {
        "name": {
          "type": "text_similarity",
          "name": "name similarity",
          "input": "{{sample.output_json.name}}",
          "reference": "{{item.name}}",
          "evaluation_metric": "fuzzy_match"
        },
        "email": {
          "type": "string_check",
          "name": "email equality",
          "input": "{{sample.output_json.email}}",
          "reference": "{{item.email}}",
          "operation": "eq"
        }
      },
      "calculate_output": "(name + email) / 2"
    },
    "item": {
      "name": "John Doe",
      "email": "john.doe@gmail.com"
    },
    "model_sample": "{\"name\":\"Jon Doe\",\"email\":\"john.doe@gmail.com\"}"
  }'
```

公式把姓名模糊相似度与邮箱精确匹配各占一半。
Standalone `run` 会在 `reward` 给总分，在 `sub_rewards` 给子分。
旧 reference 的数组示例与指南冲突，所以自动化前必须保留 validate 步骤。

### 6.4 批量聚合：同一 Eval 下比较 Run

第 3 节已给出完整的异步 Evals 场景。
要比较 prompt 或模型，只需保留同一个 Eval 与 JSONL，再创建新的 Run。
不同 Run 会各自返回 `result_counts`、`per_testing_criteria_results` 与 token 统计。

不要就地改旧 Eval 的 criteria。
更新端点只允许名称与 metadata；grader 变化应创建新 Eval。
这是由公开更新面推导出的研究判断，不是单独的 regrade API 承诺。

## 7. 结果、诊断、artifact、CI 与 regrade

### 7.1 两层结果形状

| 层级 | 主要字段 | 用途 |
| --- | --- | --- |
| Standalone grader | `reward`、`sub_rewards`、`metadata.errors`、token usage | 调试一个 grader |
| Eval Run | status、`result_counts`、每项 criterion 统计、model usage、`report_url` | 看整批表现 |
| output item | `item`、`sample`、每项 `{ passed, score }`、error | 定位单行失败 |

`report_url` 是 Dashboard 报告入口。
output item API 是逐行机器可读诊断面。
公开 Evals reference 没有独立 artifact 上传或下载端点。
输入 JSONL 位于 Files API，结果则留在 Run、output item 与 Dashboard 中。

### 7.2 诊断顺序

1. 先看 Run `status` 与顶层 `error`。
2. 再核对 `result_counts.errored`，不要把它并入普通 fail。
3. 用 output item 的 status 筛出失败行，并看各 criterion 的 `score`。
4. Standalone Judge 或 Python 失败时，逐个检查 `metadata.errors`。
5. 对 Judge 同时保存模型名、token usage、rubric 版本与人工样本集版本。

最后一步是研究建议。
公开对象没有 grader 配置 hash，也没有完整的可复现实验清单。

### 7.3 CI 与事件通知

Evals Run 是异步任务。
CI 可以轮询 retrieve，也可以订阅 `eval.run.succeeded`、`eval.run.failed` 与
`eval.run.canceled` 三种 webhook 事件。
[Evals 指南的结果小节](https://developers.openai.com/api/docs/guides/evals#analyze-the-results)列出这三个事件。

OpenAI 的最佳实践建议每次变更持续评估，并用人工判断校准自动 grader。
但 Evals 的关闭日期早于长期 CI 的合理寿命。
新 CI 不应围绕即将关闭的 Evals API 建立不可迁移依赖。

OpenAI 提供的迁移流程把两类内容分开：

- “Download runnable Promptfoo config”产生后续可执行配置。
- 历史结果需另行下载，再用 `promptfoo import` 导入。
- 新 Promptfoo run 与旧 Evals Run 是不同执行。
- 相似度分值与手工重建的 Judge 可能不相等，迁移后必须重新校准。

### 7.4 regrade

API 没有“用新 grader 对既有 Run 原地重算”的专用端点。
若保留了 `item` 与 `sample`，可用 `jsonl` Run 数据入口把它们再次提交。
若只保留原始 `item`，用 Responses 或 Completions 新建 Run 会重新采样，不能视为纯 regrade。

这是公开数据入口与更新限制共同支持的研究判断。
平台关闭前，还应按官方迁移流程分别导出可运行配置与历史结果。

## 8. 自定义扩展

### 8.1 Python grader

Python 是唯一允许作者直接写算法的 grader。
下面对象可直接交给 `validate`，再用 `run` 试一个样本：

```json
{
  "type": "python",
  "name": "required keys",
  "image_tag": "2025-05-08",
  "source": "def grade(sample, item):\n    data = sample.get('output_json', {})\n    required = item.get('required', [])\n    return sum(1 for key in required if key in data) / max(len(required), 1)"
}
```

它能返回部分分，但不能联网，也不能安装额外依赖。
异常与无效 float 会变成 `0`，所以应通过 `run` 主动测试空数组、坏 JSON 与缺字段。

### 8.2 Model grader

`score_model` 允许用消息、rubric、示例与模板字段扩展开放式判定。
`label_model` 适合有限类别，并把通过集合写进 `passing_labels`。
两者都是数据配置，不是可加载的自定义插件。

官方建议给 Judge 详细任务说明、多个优劣样本与人工 grade。
还应核对它能否保持人工给出的答案排序。
训练场景需同时比较 Judge 与专家评估，以发现 grader hacking。

### 8.3 组合器

`multi` 是固定表达式语言，不接受任意函数。
它可组合五种非 `multi` grader，并公开所有运算符与函数。
要加入新算法，应放在 Python 子 grader 内，再由公式合成。

## 9. 好在哪里

以下是研究判断。

- `type` 判别联合让 grader 可序列化，也容易由表单、SDK 与配置生成器共同消费。
- `{{item.*}}` 与 `{{sample.*}}` 把参考数据和被测回答分开，首个例子很容易读懂。
- `validate -> run -> Eval Run` 形成从单样本到批量的渐进路径。
- `string_check` 的四个操作没有隐藏正规化，确定性边界清楚。
- `text_similarity` 把算法枚举与 Evals threshold 分开，连续分和 pass 都能看到。
- Score Model 强制 `{ result, steps }`，并返回拒答、解码、服务与 token 诊断。
- `multi.calculate_output` 把权重写成可审阅公式，子分还能从 `sub_rewards` 取回。
- Run 同时给总计、每项 criterion 与逐行结果，定位聚合差异不必只看总分。

## 10. 不好的地方与不应类比 NiceEval 的边界

以下同样是研究判断。

- Evals 已进入关闭流程，作者面无法作为长期设计参照的稳定承诺。
- Alpha Graders 与 Legacy Evals 共用相似对象，却支持不同联合成员和 threshold 字段。
- `multi` 的指南对象与 reference 示例冲突，公式变量也没有独立语法 reference。
- Python invalid 与 Score Model 非数字都压成 `0`，容易把执行故障误看成质量差。
- API 没有公开 skip、unavailable 或 no-score；Evals 只有 pass、fail 与 errored 统计。
- 模板只能访问 `item` 与 `sample`，不能表达 run、turn、资源或应用状态。
- `validate` 证明 schema 可接受，不证明 Judge 稳定、Python 边界齐全或批量 Run 可用。
- Evals criterion 创建后不能改，只能新建 Eval；没有专用 regrade 契约。
- Dashboard `report_url` 很方便，但机器可携带的完整 artifact 契约较弱。

因此，不应把 OpenAI grader 直接类比为 NiceEval 的通用 assertion。
它更接近“单样本 scorer 配置”，Evals 才负责托管批量与统计。

## 11. NiceEval 可吸收与不应复制

| 可吸收 | 理由 |
| --- | --- |
| 明确的 assertion 判别联合 | 序列化配置可穷举、可验证、可生成编辑界面 |
| 参考值与被测值分 namespace | 降低模板中数据方向写反的概率 |
| 单配置 validate 与单样本 run | 批量执行前即可发现 schema、变量和 Judge 错误 |
| 总分与子分同时返回 | 聚合公式不会抹去局部诊断 |
| 错误 flags 与 grade 分离 | 调用者能区分质量失败和执行故障 |
| 聚合公式的显式允许列表 | 可审阅，也比任意表达式更容易做安全限制 |

| 不应复制 | 理由 |
| --- | --- |
| 把异常或非数字统一写成 `0` | 会丢失失败类别，污染质量统计 |
| 只提供 `item` 与 `sample` | NiceEval 还需表达 run、turn 与资源生命周期 |
| 按产品场景改变 grader 联合 | 同一配置在 Evals、RFT、Standalone 间可移植性差 |
| 省略 no-score 与 skip | 无法诚实表达不适用或证据不足 |
| 让文档示例与 schema 漂移 | 作者无法知道该信对象、数组还是隐式公式名 |
| 依赖 Dashboard URL 作为主要报告入口 | 本地、CI 与长期保存都需要更强的机器可读 artifact |
| grader 创建后不可修改且无 regrade | 迭代 Judge 时会把定义变化与样本变化混在新 Run 中 |

NiceEval 若采用公式组合，应让变量名直接来自稳定 assertion ID，并验证引用完整性。
若采用 Judge，应把 refusal、invalid output、服务错误与普通 fail 建成不同结果。
这些建议来自 OpenAI API 的具体摩擦，不意味着复刻其产品层级。

## 12. 无法核实项

以下项目在允许的一手站点内没有一致、可固定的答案。

1. 官方滚动页面没有暴露文档 commit，也没有给 JavaScript SDK 固定版本。
2. Graders 指南列出较早的 Judge 模型快照，API reference 示例使用 `gpt-5-mini`。
3. `multi.graders` 在指南中是命名对象，旧 API reference 示例却是数组。
4. 同一旧示例的公式变量不是 grader 名称，且末尾多一个右括号。
5. 指南说 `output_json` 只在 sample 带 `response_format` 时存在。
6. Standalone `run` reference 则说合法 JSON `model_sample` 就会填入它。
7. `include_sample_schema`、Python `image_tag`、Python threshold 与 Score Model threshold 的省略语义未写明。
8. `label_model` 选中各 label 后，Standalone 数值 `reward` 的映射没有公开说明。
9. output item 的 status schema 写 `fail`，同页筛选说明却写 `failed`。
10. 除明确的 Python invalid 与 Score Model 非数字外，各类执行错误对应的 `reward` 未统一定义。
11. 当前 HTTP 文档没有说明 skip、unavailable 或 no-score 协议。
12. 历史开源 Evals registry 的版本、YAML schema 与运行规则未出现在允许的一手站点中。
13. 旧 Run grader 示例把 `metadata.token_usage` 画成对象；滚动 schema 的摘要曾把它标成数值或 `null`。
14. 公告没有给 Standalone `/fine_tuning/alpha/graders/*` 单独的关闭日期。

这些差异不宜靠营销文字或旧博客推断。
在平台关闭前仍要使用时，应把 `validate`、单样本 `run` 与最小批量 Run 都纳入接入检查。
