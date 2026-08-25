import { defineDocsCommandContribution } from "../contribution.js";
import { makeResearchCommand } from "./command.js";

/**
 * Immutable Docs command contribution. Research owns this
 * parser shape, help, receipt, errors, and renderer without becoming a Trace
 * node or providing a Layer.
 */
export const researchCommandContribution = defineDocsCommandContribution({
  name: "research",
  summary: "Create and precisely check Research-owned v1 decision inputs.",
  makeCommand: makeResearchCommand,
});
