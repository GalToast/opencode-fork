import { JitHydrator } from './src/session/jit.ts';
import { bootstrap } from './src/cli/bootstrap.ts';
import fs from 'fs/promises';
import path from 'path';

async function test() {
  await bootstrap(process.cwd(), async () => {
    console.log("=== Verification: JIT Context Hydration & MMU ===");

    // 1. Setup: Create a dummy file with unique keywords
    const dummyFile = "src/frontier_harness_jit_test.ts";
    const dummyContent = "// This file contains specific logic for the 'quantum_orchestrator' and 'hyper_routing'.\nexport const engine = '2035';";
    await fs.writeFile(dummyFile, dummyContent, "utf8");

    try {
      // 2. Simulate task context using the unique keywords
      const taskContext = "I need to fix the quantum_orchestrator implementation for hyper_routing";
      console.log(`Task Context: "${taskContext}"`);

      // 3. Trigger hydration
      console.log("Hydrating context (Turn 1)...");
      const result1 = await JitHydrator.hydrate({ taskContext, sessionID: "test-session" });

      if (result1 && result1.includes("frontier_harness_jit_test.ts")) {
        console.log("✅ JIT Discovery: Successfully paged in the related file.");
        console.log("--- Paged Content Snippet ---");
        console.log(result1.slice(0, 200) + "...");
      } else {
        throw new Error("JIT Discovery FAILED: Related file not found in context.");
      }

      // 4. Test MMU Paging (Repeated call should NOT re-page the same file to save tokens)
      console.log("\nHydrating context (Turn 2 - Same Context)...");
      const result2 = await JitHydrator.hydrate({ taskContext, sessionID: "test-session" });
      
      if (!result2) {
        console.log("✅ MMU Logic: Successfully suppressed redundant paging for the same file.");
      } else {
        console.warn("⚠️ MMU Logic: redundant paging detected. Check pagingHistory logic.");
      }

      console.log("\n✅ JIT Context Hydration & MMU Verification Finished");
    } finally {
      // Cleanup
      await fs.rm(dummyFile).catch(() => {});
    }
  });
}

test().catch(e => {
  console.error(e);
  process.exit(1);
});
