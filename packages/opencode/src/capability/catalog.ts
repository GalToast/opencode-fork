import { Command } from "@/command"
import { MCP } from "@/mcp"
import { ToolRegistry } from "@/tool/registry"
import { CapabilityEntry } from "./schema"

async function list(input?: { mcp?: boolean }) {
  const mcpCatalog = input?.mcp === false ? [] : await MCP.catalog()
  const [tools, commands] = await Promise.all([
    ToolRegistry.catalog(),
    Command.catalog(),
  ])
  const mcp = mcpCatalog.map((entry) => CapabilityEntry.parse(entry))
  return [...tools, ...mcp, ...commands]
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
}

export const CapabilityCatalog = {
  list,
}
