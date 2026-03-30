import type { AgentAdapter, AgentResult, AgentRuntime, AgentSession } from "./types.js";

export class MockAdapter implements AgentAdapter {
  readonly name: AgentRuntime;

  constructor(runtime: AgentRuntime = "mock") {
    this.name = runtime;
  }

  execute(session: AgentSession): AgentResult {
    const diff = [
      `--- a/src/example.ts`,
      `+++ b/src/example.ts`,
      `@@ -1,3 +1,5 @@`,
      ` import { foo } from './foo';`,
      `+import { bar } from './bar';`,
      ` `,
      `-export const result = foo();`,
      `+export const result = foo() + bar();`,
      `+export const VERSION = '1.1.0';`,
    ].join("\n");

    return {
      adapter: this.name,
      modelUsed: session.model,
      diff,
      output: `${this.name} adapter executed in mock mode`,
      sessionResult: null,
      toolTrace: [],
    };
  }
}
