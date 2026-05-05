import { Instance } from "./src/project/instance"
import { Provider } from "./src/provider/provider"
import { Log } from "./src/util/log"

Log.init({ print: false })

const ROOT = "C:/Users/HP/Desktop/Temp while my comp is at the shop"

await Instance.provide({
  directory: ROOT,
  fn: async () => {
    const providers = await Provider.list()
    console.log("Available providers:")
    for (const [id, info] of Object.entries(providers)) {
      console.log(`  ${id}: ${Object.keys(info.models).length} models`)
      for (const model of Object.keys(info.models).slice(0, 5)) {
        console.log(`    - ${model}`)
      }
      if (Object.keys(info.models).length > 5) {
        console.log(`    ... and ${Object.keys(info.models).length - 5} more`)
      }
    }
  },
})
