---
name: testing
description: Write or review NiceEval properties, choose a public test boundary, and reproduce and fix bugs with reduced counterexamples.
---

# Testing

Read the affected Feature and its **性质** section, then the [testing contract](../../../docs/engineering/testing/README.md) and [test architecture](../../../docs/engineering/testing/architecture.md).

1. Identify the rule at risk. Find the existing property or derive one from the Feature. Define the public observation, the rule, and the generated actions before writing test code.
2. Select the tool and entry point from the [surface table](../../../docs/engineering/testing/architecture.md#表面与工具). Generate legal action sequences and express path-specific preconditions in the rule.
3. For a bug, obtain the failing observation and shrink its action sequence before editing production code. Save the reduced counterexample in the property's fast-check examples or in the Bombadil spec's regressions directory. Then fix the production cause and verify both exploration and replay.
4. Follow the [run matrix](../../../docs/engineering/testing/architecture.md#运行). Run the affected Vitest files locally and a short Bombadil test for the affected UI spec when applicable. Leave environment-dependent projects and the legacy scenario suites to CI. Report the commands and any retained repro trace or seed and path.

Use the guide that matches the task:

- [Write a property test](../../../docs/engineering/testing/use-case/write-property-test.md) to choose a public observation, generate actions, and link the test to the property's stable anchor.
- [Write a regression](../../../docs/engineering/testing/use-case/write-regression-test.md) to reduce and save a counterexample, fix the cause, and replay it.
- [Extend a fixture](../../../docs/engineering/testing/use-case/extend-fixtures.md) to reuse project preparation or a deterministic Agent with independent resources and cleanup.
- [Split a slow test](../../../docs/engineering/testing/use-case/split-slow-test.md) to move domain checks to the lowest observable layer or split by property, then remeasure.
