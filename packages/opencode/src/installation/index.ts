/* eslint-disable @typescript-eslint/no-namespace */
import { BusEvent } from "@/bus/bus-event"
import path from "path"
import { $ } from "bun"
import z from "zod"
import { NamedError } from "@opencode-ai/util/error"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"

declare global {
  const OPENCODE_VERSION: string
  const OPENCODE_CHANNEL: string
}

const log = Log.create({ service: "installation" })

export namespace Installation {
  export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

  export const VERSION = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
  export const CHANNEL = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
  export const USER_AGENT = `opencode/${CHANNEL}/${VERSION}/${Flag.OPENCODE_CLIENT}`

  export const Event = {
    Updated: BusEvent.define(
      "installation.updated",
      z.object({
        version: z.string(),
      }),
    ),
    UpdateAvailable: BusEvent.define(
      "installation.update-available",
      z.object({
        version: z.string(),
      }),
    ),
  }

  export const Info = z
    .object({
      version: z.string(),
      latest: z.string(),
    })
    .meta({
      ref: "InstallationInfo",
    })
  export type Info = z.infer<typeof Info>

  export async function info() {
    return {
      version: VERSION,
      latest: await latest(),
    }
  }

  export function isPreview() {
    return CHANNEL !== "latest"
  }

  export function isLocal() {
    return CHANNEL === "local"
  }

  type DetectedMethod = Exclude<Method, "curl" | "unknown">
  type Check = {
    name: DetectedMethod
    command: () => Promise<string>
  }

  export async function method() {
    if (process.execPath.includes(path.join(".opencode", "bin"))) return "curl"
    if (process.execPath.includes(path.join(".local", "bin"))) return "curl"
    const exec = process.execPath.toLowerCase()

    const checks: Check[] = [
      {
        name: "npm",
        command: () => $`npm list -g --depth=0`.throws(false).quiet().text(),
      },
      {
        name: "yarn",
        command: () => $`yarn global list`.throws(false).quiet().text(),
      },
      {
        name: "pnpm",
        command: () => $`pnpm list -g --depth=0`.throws(false).quiet().text(),
      },
      {
        name: "bun",
        command: () => $`bun pm ls -g`.throws(false).quiet().text(),
      },
      {
        name: "brew",
        command: () => $`brew list --formula opencode`.throws(false).quiet().text(),
      },
      {
        name: "scoop",
        command: () => $`scoop list opencode`.throws(false).quiet().text(),
      },
      {
        name: "choco",
        command: () => $`choco list --limit-output opencode`.throws(false).quiet().text(),
      },
    ]

    checks.sort((checkA, checkB) => {
      const aMatches = exec.includes(checkA.name)
      const bMatches = exec.includes(checkB.name)
      if (aMatches && !bMatches) return -1
      if (!aMatches && bMatches) return 1
      return 0
    })

    for (const check of checks) {
      const output = await check.command()
      const installedName = check.name === "brew" || check.name === "choco" || check.name === "scoop" ? "opencode" : "opencode-ai"
      if (output.includes(installedName)) {
        return check.name
      }
    }

    return "unknown"
  }

  export const UpgradeFailedError = NamedError.create(
    "UpgradeFailedError",
    z.object({
      stderr: z.string(),
    }),
  )

  const BrewFormulaTapResponseSchema = z.object({
    formulae: z.array(
      z.object({
        versions: z.object({
          stable: z.string(),
        }),
      }),
    ),
  })

  const BrewFormulaCoreResponseSchema = z.object({
    versions: z.object({
      stable: z.string(),
    }),
  })

  const RegistryPackageResponseSchema = z.object({
    version: z.string(),
  })

  const ChocolateyPackageResponseSchema = z.object({
    d: z.object({
      results: z.array(
        z.object({
          Version: z.string(),
        }),
      ),
    }),
  })

  const ScoopPackageResponseSchema = z.object({
    version: z.string(),
  })

  const GitHubReleaseResponseSchema = z.object({
    tag_name: z.string(),
  })

  async function getBrewFormula() {
    const tapFormula = await $`brew list --formula anomalyco/tap/opencode`.throws(false).quiet().text()
    if (tapFormula.includes("opencode")) return "anomalyco/tap/opencode"
    const coreFormula = await $`brew list --formula opencode`.throws(false).quiet().text()
    if (coreFormula.includes("opencode")) return "opencode"
    return "opencode"
  }

  function parseJson<T extends z.ZodTypeAny>(value: string, schema: T): z.infer<T> {
    return schema.parse(JSON.parse(value))
  }

  async function fetchJson<T extends z.ZodTypeAny>(url: string, schema: T, init?: RequestInit) {
    const response = await fetch(url, init)
    if (!response.ok) throw new Error(response.statusText)
    const raw: unknown = await response.json()
    return schema.parse(raw)
  }

  export async function upgrade(installMethod: Method, target: string) {
    let cmd
    switch (installMethod) {
      case "curl":
        cmd = $`curl -fsSL https://opencode.ai/install | bash`.env({
          ...process.env,
          VERSION: target,
        })
        break
      case "npm":
        cmd = $`npm install -g opencode-ai@${target}`
        break
      case "pnpm":
        cmd = $`pnpm install -g opencode-ai@${target}`
        break
      case "bun":
        cmd = $`bun install -g opencode-ai@${target}`
        break
      case "brew": {
        const formula = await getBrewFormula()
        if (formula.includes("/")) {
          cmd =
            $`brew tap anomalyco/tap && cd "$(brew --repo anomalyco/tap)" && git pull --ff-only && brew upgrade ${formula}`.env({
              HOMEBREW_NO_AUTO_UPDATE: "1",
              ...process.env,
            })
          break
        }
        cmd = $`brew upgrade ${formula}`.env({
          HOMEBREW_NO_AUTO_UPDATE: "1",
          ...process.env,
        })
        break
      }
      case "choco":
        cmd = $`echo Y | choco upgrade opencode --version=${target}`
        break
      case "scoop":
        cmd = $`scoop install opencode@${target}`
        break
      default:
        throw new Error(`Unknown method: ${installMethod}`)
    }
    const result = await cmd.quiet().throws(false)
    if (result.exitCode !== 0) {
      const stderr =
        installMethod === "choco" ? "not running from an elevated command shell" : result.stderr.toString("utf8")
      throw new UpgradeFailedError({
        stderr: stderr,
      })
    }
    log.info("upgraded", {
      method: installMethod,
      target,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    })
    await $`${process.execPath} --version`.nothrow().quiet().text()
  }

  export async function latest(installMethod?: Method) {
    const detectedMethod = installMethod || (await method())

    if (detectedMethod === "brew") {
      const formula = await getBrewFormula()
      if (formula.includes("/")) {
        const infoJson = await $`brew info --json=v2 ${formula}`.quiet().text()
        const brewInfo = parseJson(infoJson, BrewFormulaTapResponseSchema)
        const version = brewInfo.formulae[0]?.versions?.stable
        if (!version) throw new Error(`Could not detect version for tap formula: ${formula}`)
        return version
      }
      const data = await fetchJson("https://formulae.brew.sh/api/formula/opencode.json", BrewFormulaCoreResponseSchema)
      return data.versions.stable
    }

    if (detectedMethod === "npm" || detectedMethod === "bun" || detectedMethod === "pnpm") {
      const registryValue = await $`npm config get registry`.quiet().nothrow().text()
      const registryBase = registryValue.trim() || "https://registry.npmjs.org"
      const registry = registryBase.endsWith("/") ? registryBase.slice(0, -1) : registryBase
      const data = await fetchJson(`${registry}/opencode-ai/${CHANNEL}`, RegistryPackageResponseSchema)
      return data.version
    }

    if (detectedMethod === "choco") {
      const data = await fetchJson(
        "https://community.chocolatey.org/api/v2/Packages?$filter=Id%20eq%20%27opencode%27%20and%20IsLatestVersion&$select=Version",
        ChocolateyPackageResponseSchema,
        {
          headers: {
            Accept: "application/json;odata=verbose",
          },
        },
      )
      const version = data.d.results[0]?.Version
      if (!version) throw new Error("Could not detect version for Chocolatey package")
      return version
    }

    if (detectedMethod === "scoop") {
      const data = await fetchJson("https://raw.githubusercontent.com/ScoopInstaller/Main/master/bucket/opencode.json", ScoopPackageResponseSchema, {
        headers: {
          Accept: "application/json",
        },
      })
      return data.version
    }

    const release = await fetchJson(
      "https://api.github.com/repos/anomalyco/opencode/releases/latest",
      GitHubReleaseResponseSchema,
    )
    return release.tag_name.replace(/^v/, "")
  }
}
