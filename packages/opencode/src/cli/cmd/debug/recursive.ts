import { EOL } from "os"
import { bootstrap } from "../../bootstrap"
import { cmd } from "../cmd"

export const RecursiveCommand = cmd({
  command: "recursive",
  describe: "recursive harness adaptation is temporarily disabled",
  builder: (yargs) =>
    yargs
      .option("limit", {
        type: "number",
        default: 1,
        description: "Maximum number of open code-patch proposals to attempt in this cycle",
      })
      .option("proposal", {
        type: "array",
        string: true,
        description: "Exact proposal id(s) to target",
      })
      .option("apply-live", {
        type: "boolean",
        default: false,
        description: "Apply successful self-edits live instead of validate-only shadow runs",
      })
      .option("worker-mode", {
        type: "string",
        choices: ["pipeline", "run"],
        default: "pipeline",
        description: "Use the classic harness pipeline or launch a real opencode run worker in a shadow workspace",
      })
      .option("benchmark-model", {
        type: "string",
        description: "Exact Alibaba coding-plan model id to benchmark before/after live applies",
      })
      .option("generate-model", {
        type: "string",
        description: "Override the generation model used for autopatch authoring",
      })
      .option("review-model", {
        type: "string",
        description: "Override the adversarial review model used for autopatch review",
      })
      .option("json", {
        type: "boolean",
        default: false,
        description: "Emit machine-readable JSON instead of a human summary",
      }),
  async handler(args) {
    await bootstrap(process.cwd(), async () => {
      if (args.json) {
        process.stdout.write(
          JSON.stringify(
            {
              disabled: true,
              reason: "recursive harness adaptation is temporarily disabled",
            },
            null,
            2,
          ) + EOL,
        )
        return
      }

      process.stdout.write(`Recursive harness adaptation is temporarily disabled.${EOL}`)
    })
  },
})
