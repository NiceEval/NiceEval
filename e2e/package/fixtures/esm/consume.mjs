import { defineEval, defineExperiment } from "niceeval";

console.log(JSON.stringify({
  moduleKind: "esm",
  defineEval: typeof defineEval,
  defineExperiment: typeof defineExperiment,
}));
