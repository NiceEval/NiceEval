export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type AgentEvent =
  | { type: "message"; role: "assistant" | "user"; text: string }
  | { type: "action.called"; callId: string; name: string; input: JsonValue; tool?: string }
  | {
      type: "action.result";
      callId: string;
      output?: JsonValue;
      status: "completed" | "failed" | "rejected";
    }
  | { type: "error"; message: string };

/** 随消息附带的文件(图片等),由 fasteval 的 t.sendFile 经 adapter 带进来。 */
export interface RequestFile {
  filename?: string;
  mimeType: string;
  dataBase64: string;
}

export interface AgentRequest {
  sessionId?: string;
  message: string;
  model?: string;
  mode?: "ai" | "mock";
  /** 本轮附带的文件(图片等多模态输入)。 */
  files?: RequestFile[];
  /**
   * fasteval 的 OTLP 接收端点(本轮专属),由 adapter 经 ctx.telemetry.endpoint 带进来。
   * 给了就把本轮 turn / model / tool span 也按 OTLP/JSON 发到这儿(双可观测的第二路)。
   */
  otelEndpoint?: string;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  requests?: number;
}

export interface AgentResponse {
  sessionId: string;
  reply: string;
  events: AgentEvent[];
  data: {
    /** 本轮最后一个动作:工具名(get_weather/calculate/web_search/describe_image)或 "chat"。 */
    lastAction: string;
  };
  usage?: AgentUsage;
}
