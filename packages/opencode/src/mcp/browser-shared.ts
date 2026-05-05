import type { Config } from "@/config/config"

export const BROWSER_NAMES = ["playwright", "chrome-devtools"] as const

export type BrowserName = (typeof BROWSER_NAMES)[number]

export function isBrowserName(name: string): name is BrowserName {
  return BROWSER_NAMES.includes(name as BrowserName)
}

export function isBrowserMcp(name: string, mcp?: Config.Mcp | { enabled?: boolean }): mcp is Extract<Config.Mcp, { type: "local" }> {
  return !!mcp && "type" in mcp && mcp.type === "local" && isBrowserName(name)
}

export function augmentBrowserArgs(name: string, command: string[]) {
  if (name !== "chrome-devtools") return command

  const url = process.env.OPENCODE_CHROME_DEVTOOLS_URL?.trim()
  if (!url) return command

  if (command.some((arg) => arg === "--browser-url" || arg.startsWith("--browser-url=") || arg === "--autoConnect")) {
    return command
  }

  return [...command, `--browser-url=${url}`]
}
