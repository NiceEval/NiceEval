import { resolve } from "node:path";
import { Effect, Result, Schema } from "effect";
import { expect, test } from "vitest";
import { adapterEvidenceUnavailable } from "./attempt-resources.ts";
import { defineAdapter } from "../adapter.ts";
import { defineEval, defineExperiment } from "../define.ts";
import { modelRolesFromWire, modelRolesToWire } from "../model-roles.ts";
import { preparePluginRun, linkPluginPair } from "../plugin/link.ts";
import { ExperimentIdSchema, RunIdSchema, UtcMillisSchema } from "../record/codec/identifiers.ts";
import { canonicalizeRunContext, runContextCanonicalJson } from "../record/model/run-context.ts";
import { validateRunDocument } from "../record/model/validation.ts";
import { linkedRunRecordIdentity, type LinkedRunPlan } from "../sandbox/plan.ts";
import {
  configIdentityForRun,
  configIdentityFromResult,
  configIdentityPaths,
  configDeltas,
  counterfactualConfigIdentity,
} from "./config-identity.ts";
import {
  stableIdentityJson,
  hashIdentityPayload,
  slotExecutionIdentityInput,
  slotExecutionIdentityDigestHex,
} from "./execution-identity.ts";
import { fingerprintWithManifest } from "./fingerprint.ts";
import { attachEvalModules } from "./module-graph.ts";
import { parseSource } from "./source-normalization.ts";
import { discoverEval, EVALUATION_ALGORITHM, type AgentRun, type ExperimentInput } from "./types.ts";

// Configuration bytes retain the captured HEAD oracle. Source-derived values
// encode the literal single-node graph independently of the candidate encoder.
const HEAD_GOLDEN = {
  head: "c138c4b8e1bf8278955c025c3fa32229ba6a1920",
  source: "export default { test() {} };\n",
  cases: {
    omitted: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "24a3fd48b670314af5d0373a1ca328406fc1ab30da5a27c2ceb1a911460859a2",
      historical:
        '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
      manifest: {
        niceeval: {
          evaluationAlgorithm: "assert-first/v2",
        },
        config: {
          "adapter.name": "model-identity",
          "adapter.contract": "model-identity",
          "adapter.behaviorRevision": "1",
          "adapter.cleanupTimeoutMs": 30000,
          sandboxReuse: false,
          plugins: [],
          sandboxLayer: {
            kind: "direct",
          },
          agentInstalls: [],
        },
        plan: {
          mode: "direct",
          pair: {
            evalId: "model-identity",
            experimentId: "model-identity",
            agentName: "model-identity",
          },
        },
        plugins: {
          pair: {
            occurrences: [],
          },
        },
        source: {
          "evals/model-identity.eval.ts": "fixed-author-source-v1",
        },
        data: {},
      },
      fingerprint: "22e0b7f5517303716a56abb3103e2d088ca353bfd872530bdb089e2d3c605f2d",
      renameFingerprint: "ed5e1e76b20d4e7226da9ed8dcb4a941484652521d7a097bdf0a936f2f905387",
      slotText:
        '{"experimentId":"model-identity","evalId":"model-identity","attempt":0,"input":{"domain":"eval/v1","value":"22e0b7f5517303716a56abb3103e2d088ca353bfd872530bdb089e2d3c605f2d"},"config":{"domain":"config/v1","value":"24a3fd48b670314af5d0373a1ca328406fc1ab30da5a27c2ceb1a911460859a2"},"timeout":null}',
      slotDigest: "c704182cc4321ff905c242d9673ccb630db0d0e896bd8f63a6858ad4877866f8",
    },
    model: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Configured","value":"fixture/model"},"models":{"slots":{"default":{"model":"fixture/model","reasoningEffort":null}}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "d0faabe0a6ef93c3f68ee72a8b8a88e7df084ed99cc77560b50b8f80e2cbfd26",
      historical:
        '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Configured","value":"fixture/model"},"models":{"slots":{"default":{"model":"fixture/model","reasoningEffort":null}}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["models.default.model", "fixture/model"],
        ["models.default.reasoningEffort", null],
        ["model", "fixture/model"],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
      manifest: {
        niceeval: {
          evaluationAlgorithm: "assert-first/v2",
        },
        config: {
          "adapter.name": "model-identity",
          "adapter.contract": "model-identity",
          "adapter.behaviorRevision": "1",
          "adapter.cleanupTimeoutMs": 30000,
          "models.default.model": "fixture/model",
          "models.default.reasoningEffort": null,
          model: "fixture/model",
          sandboxReuse: false,
          plugins: [],
          sandboxLayer: {
            kind: "direct",
          },
          agentInstalls: [],
        },
        plan: {
          mode: "direct",
          pair: {
            evalId: "model-identity",
            experimentId: "model-identity",
            agentName: "model-identity",
          },
        },
        plugins: {
          pair: {
            occurrences: [],
          },
        },
        source: {
          "evals/model-identity.eval.ts": "fixed-author-source-v1",
        },
        data: {},
      },
      fingerprint: "97edd25db934c79c57ad28f40e11ee5d594072c9afcaace4f0185a7d8b96cafe",
      renameFingerprint: "01d3d9db9c3e0bc4a0f4a1798abca6b128b0cf7f9a1a260961952090bbece767",
      slotText:
        '{"experimentId":"model-identity","evalId":"model-identity","attempt":0,"input":{"domain":"eval/v1","value":"97edd25db934c79c57ad28f40e11ee5d594072c9afcaace4f0185a7d8b96cafe"},"config":{"domain":"config/v1","value":"d0faabe0a6ef93c3f68ee72a8b8a88e7df084ed99cc77560b50b8f80e2cbfd26"},"timeout":null}',
      slotDigest: "a5fcdd7576b7405f78289d07261cb8220fe6b9999997f4b289c5ddee0ef6595c",
    },
    effort: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{"default":{"model":null,"reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Configured","value":"high"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "cb70412eaad4b02c1dfde8ee22db62d8b5690b81f15d249f65d7d0cfff2416ce",
      historical:
        '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{"default":{"model":null,"reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Configured","value":"high"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["models.default.model", null],
        ["models.default.reasoningEffort", "high"],
        ["reasoningEffort", "high"],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
      manifest: {
        niceeval: {
          evaluationAlgorithm: "assert-first/v2",
        },
        config: {
          "adapter.name": "model-identity",
          "adapter.contract": "model-identity",
          "adapter.behaviorRevision": "1",
          "adapter.cleanupTimeoutMs": 30000,
          "models.default.model": null,
          "models.default.reasoningEffort": "high",
          reasoningEffort: "high",
          sandboxReuse: false,
          plugins: [],
          sandboxLayer: {
            kind: "direct",
          },
          agentInstalls: [],
        },
        plan: {
          mode: "direct",
          pair: {
            evalId: "model-identity",
            experimentId: "model-identity",
            agentName: "model-identity",
          },
        },
        plugins: {
          pair: {
            occurrences: [],
          },
        },
        source: {
          "evals/model-identity.eval.ts": "fixed-author-source-v1",
        },
        data: {},
      },
      fingerprint: "7d280410d0c9d71b9932717295fb55e94f9c68e04cf511933044f76bd655f1ca",
      renameFingerprint: "cf0c657ff0a8ccb6061b10bea3616c1af697d619c52559b50809dd34f34ea13e",
      slotText:
        '{"experimentId":"model-identity","evalId":"model-identity","attempt":0,"input":{"domain":"eval/v1","value":"7d280410d0c9d71b9932717295fb55e94f9c68e04cf511933044f76bd655f1ca"},"config":{"domain":"config/v1","value":"cb70412eaad4b02c1dfde8ee22db62d8b5690b81f15d249f65d7d0cfff2416ce"},"timeout":null}',
      slotDigest: "b438710851b075bca44b25c241f120b502155b42318ba0a1502b7696792937cc",
    },
    both: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Configured","value":"fixture/model"},"models":{"slots":{"default":{"model":"fixture/model","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Configured","value":"high"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "f6c9291fa7661015c43a7f1aba0a7fd5b3ebf26368afe217fe5d842a3dc2c9ef",
      historical:
        '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Configured","value":"fixture/model"},"models":{"slots":{"default":{"model":"fixture/model","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Configured","value":"high"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["models.default.model", "fixture/model"],
        ["models.default.reasoningEffort", "high"],
        ["model", "fixture/model"],
        ["reasoningEffort", "high"],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
      manifest: {
        niceeval: {
          evaluationAlgorithm: "assert-first/v2",
        },
        config: {
          "adapter.name": "model-identity",
          "adapter.contract": "model-identity",
          "adapter.behaviorRevision": "1",
          "adapter.cleanupTimeoutMs": 30000,
          "models.default.model": "fixture/model",
          "models.default.reasoningEffort": "high",
          model: "fixture/model",
          reasoningEffort: "high",
          sandboxReuse: false,
          plugins: [],
          sandboxLayer: {
            kind: "direct",
          },
          agentInstalls: [],
        },
        plan: {
          mode: "direct",
          pair: {
            evalId: "model-identity",
            experimentId: "model-identity",
            agentName: "model-identity",
          },
        },
        plugins: {
          pair: {
            occurrences: [],
          },
        },
        source: {
          "evals/model-identity.eval.ts": "fixed-author-source-v1",
        },
        data: {},
      },
      fingerprint: "b9c4690d16023127cde8db6a5dd5e120803c493c788e534481b71b25a6d8070f",
      renameFingerprint: "43a36cb982a86d6c277eb784d05637332c2ff555cda899d600d67f80006560bc",
      slotText:
        '{"experimentId":"model-identity","evalId":"model-identity","attempt":0,"input":{"domain":"eval/v1","value":"b9c4690d16023127cde8db6a5dd5e120803c493c788e534481b71b25a6d8070f"},"config":{"domain":"config/v1","value":"f6c9291fa7661015c43a7f1aba0a7fd5b3ebf26368afe217fe5d842a3dc2c9ef"},"timeout":null}',
      slotDigest: "b8b8786b4f22cd6101978f5a69d4d4aa851e933e89b5e06adfafceec410e6511",
    },
    explicit: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Configured","value":"fixture/model"},"models":{"slots":{"default":{"model":"fixture/model","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Configured","value":"high"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "f6c9291fa7661015c43a7f1aba0a7fd5b3ebf26368afe217fe5d842a3dc2c9ef",
      historical:
        '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Configured","value":"fixture/model"},"models":{"slots":{"default":{"model":"fixture/model","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Configured","value":"high"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["models.default.model", "fixture/model"],
        ["models.default.reasoningEffort", "high"],
        ["model", "fixture/model"],
        ["reasoningEffort", "high"],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
      manifest: {
        niceeval: {
          evaluationAlgorithm: "assert-first/v2",
        },
        config: {
          "adapter.name": "model-identity",
          "adapter.contract": "model-identity",
          "adapter.behaviorRevision": "1",
          "adapter.cleanupTimeoutMs": 30000,
          "models.default.model": "fixture/model",
          "models.default.reasoningEffort": "high",
          model: "fixture/model",
          reasoningEffort: "high",
          sandboxReuse: false,
          plugins: [],
          sandboxLayer: {
            kind: "direct",
          },
          agentInstalls: [],
        },
        plan: {
          mode: "direct",
          pair: {
            evalId: "model-identity",
            experimentId: "model-identity",
            agentName: "model-identity",
          },
        },
        plugins: {
          pair: {
            occurrences: [],
          },
        },
        source: {
          "evals/model-identity.eval.ts": "fixed-author-source-v1",
        },
        data: {},
      },
      fingerprint: "b9c4690d16023127cde8db6a5dd5e120803c493c788e534481b71b25a6d8070f",
      renameFingerprint: "43a36cb982a86d6c277eb784d05637332c2ff555cda899d600d67f80006560bc",
      slotText:
        '{"experimentId":"model-identity","evalId":"model-identity","attempt":0,"input":{"domain":"eval/v1","value":"b9c4690d16023127cde8db6a5dd5e120803c493c788e534481b71b25a6d8070f"},"config":{"domain":"config/v1","value":"f6c9291fa7661015c43a7f1aba0a7fd5b3ebf26368afe217fe5d842a3dc2c9ef"},"timeout":null}',
      slotDigest: "b8b8786b4f22cd6101978f5a69d4d4aa851e933e89b5e06adfafceec410e6511",
    },
    multi: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{"planner":{"model":"fixture/planner","reasoningEffort":null},"reviewer":{"model":"fixture/reviewer","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "c80b30c8cb6fc97ca3a131ce5e574d7ccf39bfb11b663ec62f62bcec5eda5d85",
      historical:
        '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{"planner":{"model":"fixture/planner","reasoningEffort":null},"reviewer":{"model":"fixture/reviewer","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["models.planner.model", "fixture/planner"],
        ["models.planner.reasoningEffort", null],
        ["models.reviewer.model", "fixture/reviewer"],
        ["models.reviewer.reasoningEffort", "high"],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
      manifest: {
        niceeval: {
          evaluationAlgorithm: "assert-first/v2",
        },
        config: {
          "adapter.name": "model-identity",
          "adapter.contract": "model-identity",
          "adapter.behaviorRevision": "1",
          "adapter.cleanupTimeoutMs": 30000,
          "models.planner.model": "fixture/planner",
          "models.planner.reasoningEffort": null,
          "models.reviewer.model": "fixture/reviewer",
          "models.reviewer.reasoningEffort": "high",
          sandboxReuse: false,
          plugins: [],
          sandboxLayer: {
            kind: "direct",
          },
          agentInstalls: [],
        },
        plan: {
          mode: "direct",
          pair: {
            evalId: "model-identity",
            experimentId: "model-identity",
            agentName: "model-identity",
          },
        },
        plugins: {
          pair: {
            occurrences: [],
          },
        },
        source: {
          "evals/model-identity.eval.ts": "fixed-author-source-v1",
        },
        data: {},
      },
      fingerprint: "3e686c21ab7e05df94e92e9810bb363a68d43cc8bfbe0240dda6399609274658",
      renameFingerprint: "ab0e7ee3207e8b8f479923f7c7023b15d3fbdd6f33dbd17b139ed82ee955d87c",
      slotText:
        '{"experimentId":"model-identity","evalId":"model-identity","attempt":0,"input":{"domain":"eval/v1","value":"3e686c21ab7e05df94e92e9810bb363a68d43cc8bfbe0240dda6399609274658"},"config":{"domain":"config/v1","value":"c80b30c8cb6fc97ca3a131ce5e574d7ccf39bfb11b663ec62f62bcec5eda5d85"},"timeout":null}',
      slotDigest: "090824e1659879787d757a6d88723ed812f6fca9d645fc95382e117812a5c89f",
    },
    reordered: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{"planner":{"model":"fixture/planner","reasoningEffort":null},"reviewer":{"model":"fixture/reviewer","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "c80b30c8cb6fc97ca3a131ce5e574d7ccf39bfb11b663ec62f62bcec5eda5d85",
      historical:
        '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{"planner":{"model":"fixture/planner","reasoningEffort":null},"reviewer":{"model":"fixture/reviewer","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["models.planner.model", "fixture/planner"],
        ["models.planner.reasoningEffort", null],
        ["models.reviewer.model", "fixture/reviewer"],
        ["models.reviewer.reasoningEffort", "high"],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
      manifest: {
        niceeval: {
          evaluationAlgorithm: "assert-first/v2",
        },
        config: {
          "adapter.name": "model-identity",
          "adapter.contract": "model-identity",
          "adapter.behaviorRevision": "1",
          "adapter.cleanupTimeoutMs": 30000,
          "models.planner.model": "fixture/planner",
          "models.planner.reasoningEffort": null,
          "models.reviewer.model": "fixture/reviewer",
          "models.reviewer.reasoningEffort": "high",
          sandboxReuse: false,
          plugins: [],
          sandboxLayer: {
            kind: "direct",
          },
          agentInstalls: [],
        },
        plan: {
          mode: "direct",
          pair: {
            evalId: "model-identity",
            experimentId: "model-identity",
            agentName: "model-identity",
          },
        },
        plugins: {
          pair: {
            occurrences: [],
          },
        },
        source: {
          "evals/model-identity.eval.ts": "fixed-author-source-v1",
        },
        data: {},
      },
      fingerprint: "3e686c21ab7e05df94e92e9810bb363a68d43cc8bfbe0240dda6399609274658",
      renameFingerprint: "ab0e7ee3207e8b8f479923f7c7023b15d3fbdd6f33dbd17b139ed82ee955d87c",
      slotText:
        '{"experimentId":"model-identity","evalId":"model-identity","attempt":0,"input":{"domain":"eval/v1","value":"3e686c21ab7e05df94e92e9810bb363a68d43cc8bfbe0240dda6399609274658"},"config":{"domain":"config/v1","value":"c80b30c8cb6fc97ca3a131ce5e574d7ccf39bfb11b663ec62f62bcec5eda5d85"},"timeout":null}',
      slotDigest: "090824e1659879787d757a6d88723ed812f6fca9d645fc95382e117812a5c89f",
    },
    historicalMissing: {
      text: '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
      hash: "17b57f665ec2bb6f6440e153c6b5c3297c30ceb2e71ff46a4e49ef5f9ba9a3de",
      paths: [
        ["adapter.name", "model-identity"],
        ["adapter.contract", "model-identity"],
        ["adapter.behaviorRevision", "1"],
        ["adapter.cleanupTimeoutMs", 30000],
        ["sandboxReuse", false],
        ["plugins", []],
        [
          "sandboxLayer",
          {
            kind: "direct",
          },
        ],
        ["agentInstalls", []],
      ],
    },
  },
  deltas: [
    {
      _tag: "Added",
      selector: "config:models.default.model",
      to: "null",
    },
    {
      _tag: "Added",
      selector: "config:models.default.reasoningEffort",
      to: "high",
    },
    {
      _tag: "Removed",
      selector: "config:models.planner.model",
      from: "fixture/planner",
    },
    {
      _tag: "Removed",
      selector: "config:models.planner.reasoningEffort",
      from: "null",
    },
    {
      _tag: "Removed",
      selector: "config:models.reviewer.model",
      from: "fixture/reviewer",
    },
    {
      _tag: "Removed",
      selector: "config:models.reviewer.reasoningEffort",
      from: "high",
    },
    {
      _tag: "Added",
      selector: "config:reasoningEffort",
      to: "high",
    },
  ],
  counterfactual:
    '{"adapter":{"behaviorRevision":"1","cleanupTimeoutMs":30000,"contract":"model-identity","name":"model-identity"},"agentInstalls":[],"flags":{},"judgeRuntime":{"_tag":"Unconfigured"},"model":{"_tag":"Omitted"},"models":{"slots":{"planner":{"model":"fixture/planner","reasoningEffort":null},"reviewer":{"model":"fixture/reviewer","reasoningEffort":"high"}}},"plugins":[],"reasoningEffort":{"_tag":"Omitted"},"sandboxLayer":{"kind":"direct"},"sandboxReuse":false}',
} as const;

const adapter = defineAdapter({ name: "model-identity", behaviorRevision: "1", create: () => ({}) });
const selections = {
  omitted: {},
  model: { model: "fixture/model" },
  effort: { reasoningEffort: "high" },
  both: { model: "fixture/model", reasoningEffort: "high" },
  explicit: { models: { default: { model: "fixture/model", reasoningEffort: "high" } } },
  multi: {
    models: { planner: { model: "fixture/planner" }, reviewer: { model: "fixture/reviewer", reasoningEffort: "high" } },
  },
  reordered: {
    models: { reviewer: { model: "fixture/reviewer", reasoningEffort: "high" }, planner: { model: "fixture/planner" } },
  },
} satisfies Record<string, Omit<ExperimentInput<typeof adapter>, "adapter">>;

function pairFor(input: (typeof selections)[keyof typeof selections]) {
  const def = defineExperiment({ adapter, ...input });
  const run: AgentRun = {
    ...def,
    agent: undefined,
    experimentId: "model-identity",
    experimentBaseDir: resolve("experiments"),
    experimentSourcePath: resolve("experiments/model-identity.ts"),
    selectedEvalIds: ["model-identity"],
    sandboxBeforeCache: "use",
    timeoutSource: undefined,
    pluginBehavior: [],
    setup: undefined,
    teardown: undefined,
  };
  const source = HEAD_GOLDEN.source;
  const path = resolve("evals/model-identity.eval.ts");
  const definition = defineEval({ test() {} });
  const evalDef = discoverEval(definition, {
    id: "model-identity",
    baseDir: resolve("evals"),
    sourcePath: path,
    loaderDataPaths: [],
    criteriaPaths: [],
    privatePaths: [],
    source: { path: "evals/model-identity.eval.ts", content: source, sha256: hashIdentityPayload(source) },
    definition,
    evalGroup: undefined,
  });
  attachEvalModules(evalDef, {
    root: resolve("."),
    entry: path,
    modules: [
      {
        path,
        source,
        normalized: source,
        identity: "fixed-author-source-v1",
        sourceType: "module",
        language: "ts",
        program: parseSource(path, source).program,
        comments: [],
        locationObservations: [],
        edges: [],
        unresolved: [],
      },
    ],
    unresolved: [],
  });
  const plan: LinkedRunPlan = {
    _tag: "Direct",
    pair: { kind: "direct", evalId: evalDef.id, experimentId: run.experimentId, agentName: "model-identity" },
  };
  return {
    key: "model-identity",
    run,
    sourceRun: run,
    evalDef,
    plan,
    identity: linkedRunRecordIdentity(plan),
    plugin: linkPluginPair(evalDef, preparePluginRun(run)),
  };
}

function historicalResult(pair: ReturnType<typeof pairFor>, includeModels = true): import("./types.ts").EvalResult {
  return {
    adapter: configIdentityForRun(pair.run, pair.plan).adapter,
    ...(pair.run.model === undefined ? {} : { model: pair.run.model }),
    id: pair.evalDef.id,
    verdict: "passed",
    evaluationAlgorithm: EVALUATION_ALGORITHM,
    attempt: 0,
    durationMs: 0,
    factResults: [],
    factUses: [],
    evaluationKind: "pass",
    evidenceCoverage: adapterEvidenceUnavailable,
    experiment: {
      ...(includeModels ? { models: modelRolesToWire(pair.run.models ?? {}) } : {}),
      ...(pair.run.reasoningEffort === undefined ? {} : { reasoningEffort: pair.run.reasoningEffort }),
      attempts: 1,
      earlyExit: false,
      sandboxLayer: { kind: "direct" },
      sandboxPlansByEval: {},
      agentInstalls: [],
    },
  };
}

// @feature docs/feature/experiments/README.md
test.each(Object.entries(selections))(
  "model configuration %s retains its independent identity",
  async (name, input) => {
    const expected = HEAD_GOLDEN.cases[name as keyof typeof selections];
    const pair = pairFor(input);
    const identity = configIdentityForRun(pair.run, pair.plan);
    expect(stableIdentityJson(identity)).toBe(expected.text);
    expect(hashIdentityPayload(identity)).toBe(expected.hash);
    expect(configIdentityPaths(identity)).toEqual(expected.paths);
    const historical = configIdentityFromResult(historicalResult(pair));
    expect(stableIdentityJson(historical)).toBe(expected.historical);
    if (historical === undefined) throw new Error("Expected recorded configuration");
    expect(configDeltas(historical, identity)).toEqual([]);
    const fp = await Effect.runPromise(fingerprintWithManifest(pair));
    expect(fp.manifest).toEqual(expected.manifest);
    expect(fp.fingerprint).toBe(expected.fingerprint);
    expect(fp.renameFingerprint("renamed")).toBe(expected.renameFingerprint);
    const slot = {
      experimentId: "model-identity",
      evalId: pair.evalDef.id,
      attempt: 0,
      input: { domain: "eval/v1", value: fp.fingerprint },
      config: { domain: "config/v1", value: hashIdentityPayload(identity) },
      timeout: null,
    };
    expect(slotExecutionIdentityInput(slot)).toBe(expected.slotText);
    expect(slotExecutionIdentityDigestHex(slot)).toBe(expected.slotDigest);
    const wire = modelRolesToWire(pair.run.models ?? {});
    expect(modelRolesToWire(modelRolesFromWire(wire))).toEqual(wire);
    const context = {
      experimentId: Schema.decodeUnknownSync(ExperimentIdSchema)("model-identity"),
      execution: {
        adapter: identity.adapter,
        models: wire,
        model: pair.run.model ?? null,
        reasoningEffort: pair.run.reasoningEffort ?? null,
        flags: {},
      },
      labels: {},
    };
    const decoded = canonicalizeRunContext(context);
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isFailure(decoded)) throw new Error("Context must accept nullable model wire");
    const json = runContextCanonicalJson(decoded.success);
    const headIdentity = JSON.parse(expected.text);
    expect(json).toBe(
      stableIdentityJson({
        experimentId: "model-identity",
        execution: {
          adapter: headIdentity.adapter,
          models: headIdentity.models.slots,
          model: headIdentity.model._tag === "Configured" ? headIdentity.model.value : null,
          reasoningEffort:
            headIdentity.reasoningEffort._tag === "Configured" ? headIdentity.reasoningEffort.value : null,
          flags: {},
        },
        labels: {},
      }),
    );
    const again = canonicalizeRunContext(JSON.parse(json));
    if (Result.isFailure(again)) throw new Error("Context must be revalidatable");
    expect(runContextCanonicalJson(again.success)).toBe(json);
    expect(
      validateRunDocument({
        runId: Schema.decodeUnknownSync(RunIdSchema)("00000000-0000-4000-8000-000000000001"),
        experimentId: again.success.experimentId,
        context: again.success,
        startedAt: Schema.decodeUnknownSync(UtcMillisSchema)(0),
        completedAt: Schema.decodeUnknownSync(UtcMillisSchema)(1),
        expectedSlots: [],
      }),
    ).toEqual([]);
  },
);

// @feature docs/feature/experiments/README.md
test("historical omission and whole-model authorization retain identity distinctions", () => {
  const pair = pairFor(selections.omitted);
  const historical = configIdentityFromResult(historicalResult(pair, false));
  if (historical === undefined) throw new Error("Historical configuration must exist without models");
  expect(Object.hasOwn(historical, "models")).toBe(false);
  expect(stableIdentityJson(historical)).toBe(HEAD_GOLDEN.cases.historicalMissing.text);
  expect(hashIdentityPayload(historical)).toBe(HEAD_GOLDEN.cases.historicalMissing.hash);
  expect(configIdentityPaths(historical)).toEqual(HEAD_GOLDEN.cases.historicalMissing.paths);
  const priorPair = pairFor(selections.multi),
    currentPair = pairFor(selections.effort);
  const prior = configIdentityForRun(priorPair.run, priorPair.plan),
    current = configIdentityForRun(currentPair.run, currentPair.plan);
  expect(configDeltas(prior, current)).toEqual(HEAD_GOLDEN.deltas);
  const accepted = new Set(HEAD_GOLDEN.deltas.map((delta) => delta.selector));
  expect(stableIdentityJson(counterfactualConfigIdentity(current, prior, accepted))).toBe(HEAD_GOLDEN.counterfactual);
  accepted.delete("config:models.planner.model");
  expect(counterfactualConfigIdentity(current, prior, accepted).models).toEqual(current.models);
  const context = {
    experimentId: "model-identity",
    execution: { adapter: null, model: null, reasoningEffort: null, flags: {} },
    labels: {},
  };
  const read = canonicalizeRunContext(context);
  if (Result.isFailure(read)) throw new Error("Historical context must decode");
  expect(Object.hasOwn(read.success.execution, "models")).toBe(false);
  expect(runContextCanonicalJson(read.success)).toBe(stableIdentityJson(context));
});
