import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"

export const WorkspaceServeCommand = cmd({
  command: "workspace-serve",
  builder: (yargs: any) => withNetworkOptions(yargs),
  describe: "serve workspace endpoints",
  handler: async (args: any) => {
    const opts = await resolveNetworkOptions(args)
    console.log("workspace-serve starting on", opts)
  },
})
