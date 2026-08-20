import { defineExperiment } from "niceeval";
import {
  sharedStateStartupAuthorityAgent,
  sharedStateStartupAuthorityHooks,
} from "../agents/shared-state-startup-authority.ts";

export default defineExperiment({
  agent: sharedStateStartupAuthorityAgent,
  evals: ["shared-state/"],
  sharedState: { key: "runner/shared-state-startup-authority" },
  ...sharedStateStartupAuthorityHooks(),
});
