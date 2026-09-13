import { z, type ZodType } from "zod";
import type { GeneratedImage } from "./contracts";

export type ProviderMode = "live" | "fixture";

export interface StructuredRequest<T> {
  readonly name: "create_world" | "publish_post" | "reply" | "continue_thread" | "refresh_feed";
  readonly instructions: string;
  readonly input: unknown;
  readonly schema: ZodType<T>;
}

export interface ImageRequest {
  readonly prompt: string;
  readonly alt: string;
  readonly aspect: "square" | "wide";
}

export interface ContentProvider {
  readonly mode: ProviderMode;
  generateStructured<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<T>;
  generateImage(request: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage>;
}

export interface LiveProviderConfig {
  apiKey: string;
  apiBase: string;
  textModel: string;
  imageModel: string;
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function endpoint(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function errorMessage(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "object" && error !== null && "message" in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
  }
  return `provider HTTP ${status}`;
}

async function readJsonResponse(response: Response, signal?: AbortSignal): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    throw new Error("provider returned invalid JSON", { cause: error });
  }
}

function readOutputText(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) throw new Error("provider response is not an object");
  const direct = (payload as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) throw new Error("provider response has no output text");
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== "object" || part === null) continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.length > 0) return text;
    }
  }
  throw new Error("provider response has no output text");
}

export class OpenAICompatibleProvider implements ContentProvider {
  readonly mode = "live" as const;

  constructor(private readonly config: LiveProviderConfig) {
    if (!config.apiKey) throw new Error("OPENAI_API_KEY is required in live mode");
    if (!config.apiBase || !config.textModel || !config.imageModel) {
      throw new Error("OPENAI_BASE_URL, OPENAI_MODEL and OPENAI_IMAGE_MODEL are required in live mode");
    }
  }

  async generateStructured<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    const jsonSchema = z.toJSONSchema(request.schema) as Record<string, unknown>;
    delete jsonSchema.$schema;
    const response = await fetch(endpoint(this.config.apiBase, "responses"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.textModel,
        store: false,
        instructions: request.instructions,
        input: JSON.stringify(request.input),
        text: {
          format: {
            type: "json_schema",
            name: request.name,
            strict: true,
            schema: jsonSchema,
          },
        },
      }),
      signal: signal ?? null,
    });
    const payload = await readJsonResponse(response, signal);
    if (!response.ok) throw new Error(errorMessage(payload, response.status));
    let parsed: unknown;
    try {
      parsed = JSON.parse(readOutputText(payload));
    } catch (error) {
      throw new Error("provider returned invalid structured JSON", { cause: error });
    }
    return request.schema.parse(parsed);
  }

  async generateImage(request: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage> {
    throwIfAborted(signal);
    const response = await fetch(endpoint(this.config.apiBase, "images/generations"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.imageModel,
        prompt: request.prompt,
        size: request.aspect === "wide" ? "1536x1024" : "1024x1024",
        n: 1,
      }),
      signal: signal ?? null,
    });
    const payload = await readJsonResponse(response, signal);
    if (!response.ok) throw new Error(errorMessage(payload, response.status));
    const first = typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data[0]
      : undefined;
    if (typeof first !== "object" || first === null) throw new Error("image provider returned no image");
    const b64 = (first as { b64_json?: unknown }).b64_json;
    const url = (first as { url?: unknown }).url;
    if (typeof b64 === "string" && b64.length > 0) {
      return { url: `data:image/png;base64,${b64}`, alt: request.alt, source: "live" };
    }
    if (typeof url === "string" && url.length > 0) return { url, alt: request.alt, source: "live" };
    throw new Error("image provider returned neither b64_json nor url");
  }
}

export function createProviderFromEnv(env: NodeJS.ProcessEnv = process.env): ContentProvider {
  const mode = env.PROVIDER_MODE ?? "fixture";
  if (mode === "fixture") return new FixtureProvider();
  if (mode !== "live") throw new Error("PROVIDER_MODE must be fixture or live");
  return new OpenAICompatibleProvider({
    apiKey: env.OPENAI_API_KEY ?? "",
    apiBase: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    textModel: env.OPENAI_MODEL ?? "",
    imageModel: env.OPENAI_IMAGE_MODEL ?? "",
  });
}

function fixtureSvg(label: string, aspect: "square" | "wide"): string {
  const width = aspect === "wide" ? 1200 : 640;
  const height = aspect === "wide" ? 500 : 640;
  const safe = label.replace(/[<>&"']/g, "").slice(0, 42);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#10131a"/><stop offset="1" stop-color="#1d9bf0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${width * 0.74}" cy="${height * 0.3}" r="${height * 0.22}" fill="#ffd400" opacity=".8"/><text x="8%" y="82%" fill="white" font-family="sans-serif" font-size="${Math.round(height * 0.075)}" font-weight="700">FIXTURE · ${safe}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export class FixtureProvider implements ContentProvider {
  readonly mode = "fixture" as const;
  private turn = 0;

  async generateStructured<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<T> {
    throwIfAborted(signal);
    await Promise.resolve();
    throwIfAborted(signal);
    this.turn += 1;
    const input = request.input as Record<string, unknown>;
    let value: unknown;
    if (request.name === "create_world") {
      const player = typeof input.playerName === "string" ? input.playerName : "玩家";
      const topic = typeof input.topic === "string" ? input.topic : "城市生活";
      value = {
        viewer: profile(player, `关注${topic}的新用户`, "台北"),
        characters: [
          profile("林岚", "城市观察者，喜欢记录微小变化。", "上海"),
          profile("字节猫", "科技编辑，也写咖啡和夜行故事。", "深圳"),
          profile("森屿电台", "独立播客，收集陌生人的真实瞬间。", "成都"),
          profile("凯的速写本", "用一张图解释复杂世界。", "杭州"),
        ],
        initialPosts: [
          { content: `如果把「${topic}」当作一条街，你最想在哪个路口停下？`, imagePrompt: "editorial street photography, blue hour, people crossing, no text" },
          { content: `刚整理了关于「${topic}」的五个反常识结论，最意外的是第三个。`, imagePrompt: null },
          { content: "今晚开放录音：说一个你最近改变看法的瞬间。", imagePrompt: "cozy independent radio studio at night, warm cinematic lighting, no text" },
          { content: "热点会过去，留下来的往往是一句能被复述的话。", imagePrompt: null },
          { content: "早高峰里每个人都有目的地，也都有一小段无人知晓的支线。", imagePrompt: null },
        ],
      };
    } else if (request.name === "publish_post") {
      const intent = typeof input.intent === "string" ? input.intent : "分享一个新想法";
      value = {
        primaryContent: `${intent.trim()} —— 先把它放到时间线上，看看会遇见谁。`.slice(0, 280),
        primaryImagePrompt: input.withImage === true ? `social editorial illustration about ${intent}, vivid, no text` : null,
        reactions: [0, 1].map((index) => ({
          content: index === 0 ? "这个角度很新鲜。你会把它继续展开吗？" : "转发给也在讨论这件事的人。",
          imagePrompt: null,
        })),
      };
    } else if (request.name === "reply") {
      const intent = typeof input.intent === "string" ? input.intent : "回应讨论";
      value = {
        primaryContent: `我理解你的意思。${intent.trim()}`.slice(0, 280),
        primaryImagePrompt: null,
        reactions: [{
          content: "这串讨论开始有意思了，我也想听听其他人的经历。",
          imagePrompt: null,
        }],
      };
    } else if (request.name === "continue_thread") {
      value = {
        posts: [
          { content: "你提到的这个细节很有意思，我也遇到过类似的情况。", imagePrompt: null },
          { content: "想继续听听你后来是怎么处理的。", imagePrompt: null },
        ],
      };
    } else {
      value = {
        posts: [0, 1, 2].map((index) => ({
          content: ["刚刚路过一场意外坦率的讨论。", "时间线更新得很快，但好问题值得慢慢回答。", "把今天的一个小发现留在这里。"][index],
          imagePrompt: index === 2 && this.turn % 2 === 0 ? "minimal editorial still life, cyan and yellow, no text" : null,
        })),
      };
    }
    return request.schema.parse(value);
  }

  async generateImage(request: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage> {
    throwIfAborted(signal);
    await Promise.resolve();
    throwIfAborted(signal);
    return { url: fixtureSvg(request.alt, request.aspect), alt: `${request.alt}（SVG fixture）`, source: "fixture" };
  }
}

function profile(displayName: string, bio: string, location: string) {
  return {
    displayName,
    bio,
    location,
    avatarPrompt: `editorial portrait avatar of ${displayName}, clean background, no text`,
  };
}
