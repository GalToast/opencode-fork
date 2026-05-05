import type { Argv } from "yargs"
import type { Hooks } from "@opencode-ai/plugin"
import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { ProviderID } from "../../provider/schema"
import { EOL } from "os"

export function resolvePluginProviders(input: {
  hooks: Hooks[]
  existingProviders: Record<string, unknown>
  disabled: Set<string>
  enabled?: Set<string>
  providerNames: Record<string, string>
}) {
  const result: Array<{ id: string; name: string }> = []
  const seen = new Set<string>()

  for (const hook of input.hooks) {
    const provider = hook.auth?.provider
    if (!provider) continue
    if (seen.has(provider)) continue
    seen.add(provider)
    if (provider in input.existingProviders) continue
    if (input.disabled.has(provider)) continue
    if (input.enabled && !input.enabled.has(provider)) continue
    result.push({
      id: provider,
      name: input.providerNames[provider] ?? provider,
    })
  }

  return result
}

export const ProvidersCommand = cmd({
  command: "providers",
  describe: "list configured providers",
  builder: (yargs: Argv) =>
    yargs.option("verbose", {
      describe: "show provider details as JSON",
      type: "boolean",
    }),
  handler: async (args) => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const providers = await Provider.list()
        for (const id of Object.keys(providers).sort()) {
          const provider = providers[ProviderID.make(id)]
          process.stdout.write(`${id}\t${provider.name}`)
          process.stdout.write(EOL)
          if (args.verbose) {
            process.stdout.write(JSON.stringify(provider, null, 2))
            process.stdout.write(EOL)
          }
        }
      },
    })
  },
})
