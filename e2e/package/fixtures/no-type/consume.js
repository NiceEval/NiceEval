const { defineEval, defineExperiment } = require("niceeval");

console.log(JSON.stringify({
  moduleKind: "no-type",
  defineEval: typeof defineEval,
  defineExperiment: typeof defineExperiment,
}));
