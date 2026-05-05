import { cmd } from "./cmd"

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  handler: async () => {
    console.log("Auth command not yet implemented.")
  },
})
