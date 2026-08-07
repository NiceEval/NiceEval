const { defineEval, defineExperiment } = require("niceeval");

console.log(JSON.stringify({
  moduleKind: "cjs",
  defineEval: typeof defineEval,
  defineExperiment: typeof defineExperiment,
}));
