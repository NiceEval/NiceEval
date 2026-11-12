import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
export const inputRequestsAgent = defineAgent({
  name: "input-requests-fixture",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input) {
    if (input.responses !== undefined) return { status: "completed" as const, events: [{ type: "message" as const, role: "assistant" as const, text: input.responses.map(response => response.requestId).join(",") }] };
    if (input.text === "ordinary") return { status: "completed" as const, events: [] };
    return { status: "waiting" as const, events: [
      { type: "input.requested" as const, request: { id: "second", prompt: "first in stream", input: { nested: ["original"] }, options: [{ id: "approve", label: "Approve" }] } },
      { type: "message" as const, role: "assistant" as const, text: "between requests" },
      { type: "input.requested" as const, request: { id: "first", prompt: "second in stream", options: [{ id: "approve" }] } },
    ] };
  },
});
