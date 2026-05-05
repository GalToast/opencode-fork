import type { Arguments, Argv, CommandModule } from "yargs"

type WithDoubleDash<T> = T & { "--"?: string[] }

export function cmd<T, U>(input: CommandModule<T, WithDoubleDash<U>>) {
  return input
}

type LazyCommandDef<T> = Omit<CommandModule<T, WithDoubleDash<T>>, "handler" | "builder"> &
  Partial<CommandModule<T, WithDoubleDash<T>>>

export function lazyCmd<T>(
  input: LazyCommandDef<T>,
  loader: () => Promise<CommandModule<T, WithDoubleDash<T>>>,
): CommandModule<T, WithDoubleDash<T>> {
  let loaded: CommandModule<T, WithDoubleDash<T>> | null = null
  const load = async () => {
    if (!loaded) {
      loaded = await loader()
    }
    return loaded
  }
  return {
    ...input,
    builder: (async (parser) => {
      const def = await load()
      if (def.builder) {
        if (typeof def.builder === "function") {
          return def.builder(parser)
        }
        return parser.options(def.builder)
      }
      return parser
    }) as CommandModule<T, WithDoubleDash<T>>["builder"],
    handler: async (args) => {
      const def = await load()
      if (def.handler) {
        await def.handler(args)
      }
    },
  } as CommandModule<T, WithDoubleDash<T>>
}
