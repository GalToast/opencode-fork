import { TuiConfig, type TuiConfigInfo } from "@/config/tui"
import { createSimpleContext } from "./helper"

export const { use: useTuiConfig, provider: TuiConfigProvider } = createSimpleContext({
  name: "TuiConfig",
  init: (props: { config: TuiConfigInfo }): TuiConfigInfo => {
    return props.config
  },
})

export type TuiConfigContext = ReturnType<typeof useTuiConfig>
