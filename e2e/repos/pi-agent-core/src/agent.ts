// 真实 agent:pi SDK(@earendil-works/pi-agent-core 的 Agent + @earendil-works/pi-ai
// 的模型/provider)搭建,不是手写的 tool-calling 循环。
//
// 默认走 DeepSeek(deepseekProvider() 的模型目录里已有 deepseek-v4-flash / deepseek-v4-pro,
// 鉴权自动读 DEEPSEEK_API_KEY,见 .env.example),可通过 AGENT_MODEL 切换。
//
// 每次 /api/chat 请求都 new 一个 Agent(见 createAgent),但会话历史不能丢:pi 的 Agent 本身
// 没有落盘/resume 机制,所以 server.ts 在内存里按 sessionId 保存每轮结束后的
// agent.state.messages,下一轮通过 options.messages 原样喂回来——否则模型每轮都从零开始。
import { Agent, type AgentMessage, type AgentOptions } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { calculateTool, getWeatherTool, sendAlertTool } from "./tools.ts";

const models = createModels();
models.setProvider(deepseekProvider());

const MODEL_ID = process.env.AGENT_MODEL ?? "deepseek-v4-flash";

function resolveModel() {
  const model = models.getModel("deepseek", MODEL_ID);
  if (!model) {
    throw new Error(
      `未知模型: deepseek/${MODEL_ID}。deepseekProvider() 的目录里目前有 deepseek-v4-flash / deepseek-v4-pro。`,
    );
  }
  return model;
}

const SYSTEM_PROMPT =
  "你是一个能查天气、能做算术、能发送值班告警的助理。需要时调用工具,不要自己瞎编数字或编造已发送的告警。" +
  "如果调用工具后收到的是错误结果,如实告诉用户失败原因,不要编造一个成功的结果。";

export interface CreateAgentOptions {
  /** 转发给 pi 的 beforeToolCall——server.ts 用它给 send_alert 挂 HITL 审批。 */
  beforeToolCall?: AgentOptions["beforeToolCall"];
  /** 上一轮结束时的完整对话记录(agent.state.messages),用于跨请求续接会话。 */
  messages?: AgentMessage[];
}

/** 每次 /api/chat 调用都 new 一个 Agent,历史通过 options.messages 续接,见文件头注释。 */
export function createAgent(options: CreateAgentOptions = {}): Agent {
  return new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: resolveModel(),
      tools: [getWeatherTool, calculateTool, sendAlertTool],
      ...(options.messages ? { messages: options.messages } : {}),
    },
    // Agent 默认会用 @earendil-works/pi-ai/compat 里的全局 streamSimple,这里显式绑定
    // 我们自己建的 models(只注册了 deepseek provider),保证鉴权走的是上面 setProvider 的实例。
    streamFn: models.streamSimple.bind(models),
    beforeToolCall: options.beforeToolCall,
  });
}
