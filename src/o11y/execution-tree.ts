// ExecutionTree:标准事件流骨架 + 可选 OTel span enrichment 合成的统一执行记录
// (定稿见 docs/observability.md「OTLP traces → 统一瀑布图」、docs/concepts.md「执行树」词条)。
//
// 骨架来自 events,永远不因有没有 spans 而变形:message / thinking / context.injected /
// skill.loaded / action(operation.started + operation.finished 按 operationId 合并成一个节点)/
// subagent(同理)/ input.requested / compaction / error,每种事件一个节点,顺序 = 事件出现的顺序
// (合并节点的位置 = 它 started/loaded 那条事件的位置,finished 只更新已有节点,
// 不产生新位置)。没有 spans 时,`span` 字段整体缺失——渲染层据此判断「timing
// unavailable」,不是 0,也不是从别处反推的估算值。
//
// spans 参数假定调用方已经跑过 otlp/select.ts::selectTraceSpans——本函数不做 firehose
// 过滤,只做「一批语义 span → 骨架节点」的关联,职责单一。关联只走显式 correlation:
// span.attributes.call_id(现有 mapper 的既有约定,如 claude-code mapper 把
// tool_use_id 复制过来)或 GenAI 语义约定的 gen_ai.tool.call.id,与 action/subagent/
// skill.loaded 节点的 operationId 精确相等才算数(skill.loaded 的 operationId 是可选的——只有原生
// 协议把 Skill 加载表达成可关联的工具调用时才有,如 Claude Code 的 Skill tool_use;没有
// 就不参与关联,不影响骨架本身)——从不按 span 名字、文本内容或时间接近度去猜。一个
// operationId 必须唯一对应一条候选 span 才合并;operationId 找不到对应骨架节点,或同一个
// operationId 撞了多条候选 span(无法唯一决定该并给哪个节点),这些 span 一律降级成独立
// 标注的 telemetry-only 节点,绝不強行择一合并。
//
// 合并进节点的是【完整 span 对象】(startMs/endMs/parentSpanId/status/attributes 原样
// 保留供下钻),不重新定义耗时之类的派生字段——耗时是 endMs - startMs,渲染层自己算。
// action 节点合并时额外吃下 otlp/select.ts::enrichTraceWithIO 想做的事:那个函数把
// ToolCall.input/output 反向糊到 span.attributes 上的 io.tool/io.input/io.output/io.status
// 四个键(给独立的 trace.json/瀑布图用),这里在节点内部原地重做一遍同一份 join(同一个
// IO_MAX 截断预算,ioText 从 otlp/select.ts 直接复用,没有另立口径)——好处不是"action
// 节点自己没有 input/output"(它本来就有,且是不截断的完整 JsonValue,比 span 视角更权威),
// 而是让合并出的 span 本身也带一份和旧 enrichTraceWithIO 输出一致的属性,不强迫下游
// 区分"这份 span 是不是已经被 enrichTraceWithIO 处理过"才能读到入参出参文本。
// subagent 节点没有 tool-call 形状的 input 字段,不套用这份 io.* 注入。
//
// 没有 timingConfidence 字段的设计取舍:otlp/turn-otel.ts 在 traceparent 缺失时会退化成
// 「按时间窗口把一批 span 划给某一轮 send」的兜底归属(串行守卫下才可靠,见该文件的
// TurnSpans.attribution),这确实是比「span 精确挂在某个 operationId 下」更弱的保证。但这个
// 弱保证的信息在到达本函数之前就已经丢了——SessionManager 只在运行期 log 一次 warning
// (`otel.windowAttribution`),从不把 attribution 写回 TraceSpan 本身,所以传进来的
// spans 天生就分不出「这条是 traceparent 精确挂上的」还是「这条是窗口兜底扫进来的」。
// 就算这个信息保留了下来,也不该拿它伪造一个「timing 存在但打折扣」的中间态:窗口兜底
// 归属的是「这批 span 属于哪一轮 send」,本函数关联的是「这条 span 属于哪个 operationId 节点」
// ——两者是正交的轴。一条 span 不管是靠 traceparent 还是窗口兜底进的 trace,它自己的
// call_id 属性不变,凭 call_id 精确匹配到节点的正确性完全不受轮次归属精度影响(唯一
// 会被窗口误差污染的是「这条 span 该算哪一轮」这类跨轮聚合,ExecutionTree 不做这个)。
// 所以诚实的状态只有二元的:call_id 唯一命中 → 有 span(timing 可信);否则 → 没有,
// 不发明第三档「有 span 但不确定」。

import type { InputRequest, JsonValue, StreamEvent, ToolName, TraceSpan } from "../types.ts";
import { ioText } from "./otlp/select.ts";

// ───────────────────────── 节点类型 ─────────────────────────

interface ExecutionNodeBase {
  /** 本函数内确定性生成,同一份 (events, spans) 输入永远产出同一批 id(不是全局稳定 id,
   * 不跨调用持久化——目前没有下游需要跨次运行比对同一个节点)。 */
  id: string;
  /** 唯一关联上的 OTel span(供下钻;渲染层用 endMs - startMs 算耗时)。action 节点的
   * span.attributes 额外补了 io.tool/io.input/io.output/io.status(见 withIoAttributes);
   * 其余节点原样保留。缺失 = timing unavailable——要么这次运行没有 OTel 接入,要么有 span
   * 但没能唯一关联到这个节点上;两种情况都不是「假装有耗时」,统一表现为字段不存在。 */
  span?: TraceSpan;
}

export interface ExecutionMessageNode extends ExecutionNodeBase {
  kind: "message";
  role: "assistant" | "user";
  text: string;
}

export interface ExecutionThinkingNode extends ExecutionNodeBase {
  kind: "thinking";
  text: string;
}

/**
 * 被测系统内部机制注入进上下文的文本,不属于任何一方"说的话",不并进 `message`
 * (见 docs/feature/adapters/architecture/events.md「不变量 9」)。与 thinking / compaction
 * 同一档次的直通节点,不参与 operationId 关联。
 */
export interface ExecutionContextInjectedNode extends ExecutionNodeBase {
  kind: "context.injected";
  text: string;
  source?: string;
}

/** Skill 加载节点——一等,直接来自 StreamEvent 的 "skill.loaded",不靠工具名/文本猜。 */
export interface ExecutionSkillNode extends ExecutionNodeBase {
  kind: "skill.loaded";
  skill: string;
  /**
   * 仅当原生协议把 Skill 加载表达成可关联的工具调用时才有,和 StreamEvent 同名字段同一含义。
   * 存在时参与和 action/subagent 节点同一套 operationId 关联(见主函数 nodeByOperationId):Claude Code
   * 的 Skill 调用本身就是一次 tool_use,OTel mapper 同样会把它的 tool_use_id 复制成
   * span.attributes.call_id,唯一命中时这个节点也应该拿到 timing,不因为节点 kind 是
   * skill.loaded 就被排除在 enrichment 之外。
   */
  operationId?: string;
}

/**
 * operation.started + operation.finished 按 operationId 合并成一个节点。`status` 多了 "pending"
 * (StreamEvent 的 operation.finished.status 没有这一档)——这是 ExecutionTree 独有的中间态,
 * 表示这次运行结束时结果始终没有回来(如超时截断的 transcript),诚实地区分「还没完成」
 * 和「跑完但失败/被拒绝」。
 */
export interface ExecutionActionNode extends ExecutionNodeBase {
  kind: "action";
  operationId: string;
  /** 原始工具名(未归一化),对齐 StreamEvent.operation.started.name。 */
  name: string;
  /** 归一化后的规范工具名,省略表示 adapter 没能归一(等同 ToolCall.name 缺省为 "unknown")。 */
  tool?: ToolName;
  input: JsonValue;
  output?: JsonValue;
  status: "pending" | "completed" | "failed" | "rejected";
}

/** operation.started + operation.finished 按 operationId 合并;pending 语义同 ExecutionActionNode。 */
export interface ExecutionSubagentNode extends ExecutionNodeBase {
  kind: "subagent";
  operationId: string;
  name: string;
  remoteUrl?: string;
  output?: JsonValue;
  status: "pending" | "completed" | "failed";
}

export interface ExecutionInputRequestedNode extends ExecutionNodeBase {
  kind: "input.requested";
  request: InputRequest;
}

export interface ExecutionCompactionNode extends ExecutionNodeBase {
  kind: "compaction";
  reason?: string;
}

export interface ExecutionErrorNode extends ExecutionNodeBase {
  kind: "error";
  message: string;
}

/**
 * span 存在、有意义,但唯一关联不到任何骨架节点——原样保留成独立节点,清楚标注「只有遥测、
 * 没有对应事件」,不悄悄猜着并进某个骨架节点。`span` 是必填字段:这类节点的全部内容就是
 * 这一条 span 本身,没有骨架事件可以叠加。
 */
export interface ExecutionTelemetryNode {
  kind: "telemetry";
  id: string;
  span: TraceSpan;
}

export type ExecutionNode =
  | ExecutionMessageNode
  | ExecutionThinkingNode
  | ExecutionContextInjectedNode
  | ExecutionSkillNode
  | ExecutionActionNode
  | ExecutionSubagentNode
  | ExecutionInputRequestedNode
  | ExecutionCompactionNode
  | ExecutionErrorNode
  | ExecutionTelemetryNode;

export interface ExecutionTree {
  /**
   * 骨架节点在前,顺序 = 事件出现顺序;telemetry-only 节点(未能唯一关联的 span)
   * 按 span.startMs 追加在骨架之后——它们不属于骨架,不改变骨架的节点/顺序/内容,
   * 只是叠加在末尾的额外证据。
   */
  nodes: ExecutionNode[];
  /**
   * 这次运行是否提供过任何 span——不代表关联成功,只代表「OTel 接入过」。供渲染层区分
   * 两种不同的诚实提示:整体没有 OTel 接入(该字段为 false,所有节点自然都没有 span),
   * 和 OTel 接入了但这一个节点恰好关联不上(该字段为 true,该节点的 span 仍缺失)。
   */
  timingAvailable: boolean;
}

// ───────────────────────── 关联 key ─────────────────────────

/** span 的显式 correlation key,按优先级尝试(见模块头注:只认这两个,不猜)。 */
const CALL_ID_ATTRS = ["call_id", "gen_ai.tool.call.id"] as const;

function spanOperationId(span: TraceSpan): string | undefined {
  const attrs = span.attributes ?? {};
  for (const key of CALL_ID_ATTRS) {
    const v = attrs[key];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

/**
 * 与 `otlp/select.ts` 的 `enrichTraceWithIO` 同口径地给合并上的 span 补
 * `io.tool` / `io.input` / `io.output` / `io.status`——node 的 input/output 已经是
 * 事件流自身的完整 JsonValue(不截断,给程序化消费方);这里另外派生一份文本、按
 * `IO_MAX` 截断,给任何只认 span.attributes 通用形状的下游(比如把 span 原样转存/
 * 展示的调试视图)一份和旧 enrichTraceWithIO 输出完全一致的键。不修改传入的 span 对象。
 */
function withIoAttributes(span: TraceSpan, node: ExecutionActionNode): TraceSpan {
  const attributes: globalThis.Record<string, JsonValue> = { ...span.attributes };
  if (node.name) attributes["io.tool"] = node.name;
  if (node.input !== undefined && node.input !== null) attributes["io.input"] = ioText(node.input);
  if (node.output !== undefined && node.output !== null) attributes["io.output"] = ioText(node.output);
  if (node.status !== "pending") attributes["io.status"] = node.status;
  return { ...span, attributes };
}

// ───────────────────────── 主函数 ─────────────────────────

/**
 * 纯函数:把标准事件流(骨架)与一批已挑选好的 OTel span(可选 enrichment)合成一棵
 * ExecutionTree。events 决定节点的存在、顺序与内容;spans 只能给已存在的节点补时间,
 * 从不新增、删除或重排骨架节点。
 */
export function buildExecutionTree(events: readonly StreamEvent[], spans: readonly TraceSpan[]): ExecutionTree {
  const nodes: ExecutionNode[] = [];
  const openActionById = new Map<string, ExecutionActionNode>();
  const openSubagentById = new Map<string, ExecutionSubagentNode>();
  const correlatableByOperationId = new Map<string, (ExecutionActionNode | ExecutionSubagentNode | ExecutionSkillNode)[]>();
  const operationIdCounts = new Map<string, number>();
  let seq = 0;
  const nextId = (prefix: string): string => `${prefix}-${seq++}`;
  const operationNodeId = (prefix: "action" | "subagent", operationId: string): string => {
    const key = `${prefix}:${operationId}`;
    const count = operationIdCounts.get(key) ?? 0;
    operationIdCounts.set(key, count + 1);
    return count === 0 ? `${prefix}-${operationId}` : `${prefix}-${operationId}-${count}`;
  };
  const addCorrelatable = (
    operationId: string,
    node: ExecutionActionNode | ExecutionSubagentNode | ExecutionSkillNode,
  ): void => {
    const existing = correlatableByOperationId.get(operationId);
    if (existing) existing.push(node);
    else correlatableByOperationId.set(operationId, [node]);
  };

  for (const ev of events) {
    switch (ev.type) {
      case "message":
        nodes.push({ id: nextId("message"), kind: "message", role: ev.role, text: ev.text });
        break;

      case "thinking":
        nodes.push({ id: nextId("thinking"), kind: "thinking", text: ev.text });
        break;

      case "context.injected":
        nodes.push({ id: nextId("context-injected"), kind: "context.injected", text: ev.text, source: ev.source });
        break;

      case "skill.loaded": {
        const node: ExecutionSkillNode = { id: nextId("skill"), kind: "skill.loaded", skill: ev.skill, operationId: ev.operationId };
        if (ev.operationId) addCorrelatable(ev.operationId, node);
        nodes.push(node);
        break;
      }

      case "operation.started": {
        if (ev.operation.kind === "tool") {
          const node: ExecutionActionNode = {
            id: operationNodeId("action", ev.operationId),
            kind: "action",
            operationId: ev.operationId,
            name: ev.operation.name,
            tool: ev.operation.tool,
            input: ev.operation.input,
            status: "pending",
          };
          openActionById.set(ev.operationId, node);
          addCorrelatable(ev.operationId, node);
          nodes.push(node);
        } else {
          const node: ExecutionSubagentNode = {
            id: operationNodeId("subagent", ev.operationId),
            kind: "subagent",
            operationId: ev.operationId,
            name: ev.operation.name,
            remoteUrl: ev.operation.remoteUrl,
            status: "pending",
          };
          openSubagentById.set(ev.operationId, node);
          addCorrelatable(ev.operationId, node);
          nodes.push(node);
        }
        break;
      }

      case "operation.finished": {
        if (ev.kind === "tool") {
          const existing = openActionById.get(ev.operationId);
          if (existing) {
            existing.output = ev.output;
            existing.status = ev.status;
            openActionById.delete(ev.operationId);
          } else {
            const node: ExecutionActionNode = {
              id: operationNodeId("action", ev.operationId),
              kind: "action",
              operationId: ev.operationId,
              name: "unknown",
              input: null,
              output: ev.output,
              status: ev.status,
            };
            addCorrelatable(ev.operationId, node);
            nodes.push(node);
          }
        } else {
          const existing = openSubagentById.get(ev.operationId);
          if (existing) {
            existing.output = ev.output;
            existing.status = ev.status;
            openSubagentById.delete(ev.operationId);
          } else {
            const node: ExecutionSubagentNode = {
              id: operationNodeId("subagent", ev.operationId),
              kind: "subagent",
              operationId: ev.operationId,
              name: "unknown",
              output: ev.output,
              status: ev.status,
            };
            addCorrelatable(ev.operationId, node);
            nodes.push(node);
          }
        }
        break;
      }

      case "input.requested":
        nodes.push({ id: nextId("input"), kind: "input.requested", request: ev.request });
        break;

      case "compaction":
        nodes.push({ id: nextId("compaction"), kind: "compaction", reason: ev.reason });
        break;

      case "error":
        nodes.push({ id: nextId("error"), kind: "error", message: ev.message });
        break;

      default: {
        // 穷尽性检查:StreamEvent 加新变体时这里编译报错,提醒同步补一个节点类型。
        const _exhaustive: never = ev;
        void _exhaustive;
      }
    }
  }

  // 按 operationId 分组候选 span;没有 operationId 的直接进「待定为 telemetry-only」。
  const spansByOperationId = new Map<string, TraceSpan[]>();
  const uncorrelated: TraceSpan[] = [];
  for (const span of spans) {
    const operationId = spanOperationId(span);
    if (!operationId) {
      uncorrelated.push(span);
      continue;
    }
    const list = spansByOperationId.get(operationId);
    if (list) list.push(span);
    else spansByOperationId.set(operationId, [span]);
  }

  const telemetry: ExecutionTelemetryNode[] = [];
  for (const [operationId, candidates] of spansByOperationId) {
    const matchingNodes = correlatableByOperationId.get(operationId) ?? [];
    const node = matchingNodes[0];
    if (matchingNodes.length === 1 && node && candidates.length === 1) {
      const matched = candidates[0];
      // action 节点额外补 io.tool/io.input/io.output/io.status——同 otlp/select.ts 的
      // enrichTraceWithIO 一个口径(同一个 IO_MAX 截断预算),这里在节点内部原地做一遍,
      // 不依赖调用方传入的 spans 是不是已经被 enrichTraceWithIO 处理过。subagent 与
      // skill.loaded 节点没有对应的 tool-call 形状入参/出参字段,原样保留 span,不发明 io.* 键。
      node.span = node.kind === "action" ? withIoAttributes(matched, node) : matched;
    } else {
      // 没有对应骨架节点,或同一 operationId 撞了多条 span(无法唯一决定该并给谁)——
      // 都降级为 telemetry-only,不強行择一合并。
      for (const span of candidates) telemetry.push({ id: `telemetry-${span.spanId}`, kind: "telemetry", span });
    }
  }
  for (const span of uncorrelated) telemetry.push({ id: `telemetry-${span.spanId}`, kind: "telemetry", span });
  telemetry.sort((a, b) => a.span.startMs - b.span.startMs);

  return {
    nodes: [...nodes, ...telemetry],
    timingAvailable: spans.length > 0,
  };
}
