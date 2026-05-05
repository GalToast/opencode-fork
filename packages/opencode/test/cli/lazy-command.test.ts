import { describe, expect, test } from "bun:test"
import yargs from "yargs"
import { lazyCmd } from "../../src/cli/cmd/cmd"

describe("lazyCmd", () => {
  test("defers module loading until the command is actually parsed", async () => {
    let loads = 0
    let handled = false

    const command = lazyCmd({ command: "lazy", describe: "lazy command" }, async () => {
      loads += 1
      return {
        command: "lazy",
        builder: (parser) =>
          parser.option("flag", {
            type: "boolean",
            default: false,
          }),
        handler: async (args) => {
          handled = args.flag === true
        },
      }
    })

    const cli = yargs([])
      .scriptName("opencode")
      .exitProcess(false)
      .help(false)
      .version(false)
      .command(command)

    expect(loads).toBe(0)

    await cli.parseAsync(["lazy", "--flag"])

    expect(loads).toBe(1)
    expect(handled).toBe(true)
  })

  test("reuses one loaded command instance across builder and handler", async () => {
    let loads = 0
    let built = 0
    let handled = 0

    const command = lazyCmd({ command: "lazy-object", describe: "lazy command with builder object" }, async () => {
      loads += 1
      return {
        command: "lazy-object",
        builder: {
          value: {
            type: "string",
            demandOption: true,
          },
        },
        handler: async (args) => {
          built += 1
          if (args.value === "ok") handled += 1
        },
      }
    })

    const cli = yargs([])
      .scriptName("opencode")
      .exitProcess(false)
      .help(false)
      .version(false)
      .command(command)

    await cli.parseAsync(["lazy-object", "--value", "ok"])

    expect(loads).toBe(1)
    expect(built).toBe(1)
    expect(handled).toBe(1)
  })
})
