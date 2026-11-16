import { Schema } from "effect";
import type { StreamEvent, Turn, TurnInput } from "niceeval";
import {
  completeEvidenceCoverage,
  createSessionKey,
  defineAgent,
  driveFrameStream,
  openSseJsonFrames,
  type AgentContext,
  type SseFrameCursor,
} from "niceeval/adapter";
import { fixtureBaseUrl } from "../src/fixture/address.ts";

const FrameSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("approval") }),
  Schema.Struct({ type: Schema.Literal("message"), text: Schema.String }),
]);
type Frame = typeof FrameSchema.Type;
const heldKey = createSessionKey<SseFrameCursor<Frame>>("frame-session/held");
const reducer = {
  add(frame: Frame): StreamEvent[] {
    return frame.type === "message" ? [{ type: "message", role: "assistant", text: frame.text }] : [];
  },
};

function read(cursor: SseFrameCursor<Frame>, ctx: AgentContext): Promise<Turn> {
  return driveFrameStream(cursor, reducer, ctx, (frame) => {
    if (frame.type !== "approval") return;
    ctx.session.set(heldKey, cursor);
    return { pause: { id: "frame-approval", action: "continue", options: [{ id: "approve" }] } };
  });
}

async function send(_input: TurnInput, ctx: AgentContext): Promise<Turn> {
  const pending = ctx.session.take(heldKey);
  if (pending !== undefined) {
    try {
      const approval = await fetch(`${fixtureBaseUrl()}/approve`, { method: "POST", signal: ctx.signal });
      if (!approval.ok) throw new Error("Frame session approval failed");
    } catch (error) {
      try {
        await pending.return();
      } catch {
        ctx.diagnostic({ code: "stream-cleanup-failed", level: "warning", message: "Stream cleanup failed." });
      }
      throw error;
    }
    return read(pending, ctx);
  }
  const cursor = await openSseJsonFrames(
    ctx,
    async (signal) => {
      const response = await fetch(`${fixtureBaseUrl()}/stream`, { signal });
      if (!response.ok || response.body === null) throw new Error("Frame session stream failed");
      return response.body;
    },
    FrameSchema,
  );
  return read(cursor, ctx);
}

export default defineAgent({
  name: "frame-session",
  evidenceCoverage: completeEvidenceCoverage,
  send,
});
