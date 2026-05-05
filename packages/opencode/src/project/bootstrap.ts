import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Snapshot } from "../snapshot"
import { Project } from "./project"
import { Vcs } from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Log } from "@/util/log"
import { ShareNext } from "@/share/share-next"
import { Config } from "@/config/config"
import { MCP } from "@/mcp"

const BROWSER_MCP_SERVERS = new Set(["chrome-devtools", "playwright"])

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  ShareNext.init()
  Format.init()
  await LSP.init()
  File.init()
  FileWatcher.init()
  Vcs.init()
  Snapshot.init()
  void warmBrowserMcpServers()

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      Project.setInitialized(Instance.project.id)
    }
  })
}

async function warmBrowserMcpServers() {
  try {
    const config = await Config.get()
    const names = Object.keys(config.mcp ?? {}).filter((name) => BROWSER_MCP_SERVERS.has(name))
    await Promise.all(names.map((name) => MCP.connect(name).catch((error) => Log.Default.warn("failed to warm browser MCP", { name, error }))))
  } catch (error) {
    Log.Default.warn("failed to inspect browser MCP config", { error })
  }
}
