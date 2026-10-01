// The live fixture runs Claude Code through an Anthropic-compatible gateway whose
// model aliases reject Claude Code's prompt-cache controls. Cache behavior is not
// part of this adapter Journey, so keep requests on the gateway's supported surface.
export const claudeCodeProviderEnv = Object.freeze({
  DISABLE_PROMPT_CACHING: "1",
  // The gateway's non-Claude model must receive complete MCP tool schemas;
  // it does not implement Anthropic's deferred tool_reference protocol.
  ENABLE_TOOL_SEARCH: "false",
});
