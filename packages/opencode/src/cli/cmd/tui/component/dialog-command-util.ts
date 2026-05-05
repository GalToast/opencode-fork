import { runWithOwner, type Owner } from "solid-js"

export type SlashDefinition = {
  name: string
  aliases?: string[]
}

export type SlashCommandSource = {
  value: string
  title?: string
  description?: string
  slash?: SlashDefinition
  enabled?: boolean
  hidden?: boolean
}

export function invokeCommandOwner<T>(owner: Owner | null | undefined, fn: () => T): T {
  if (!owner) return fn()
  return runWithOwner(owner, fn) as T
}

export function createSlashCommandOption(option: SlashCommandSource, onSelect: () => void) {
  const slash = option.slash
  if (!slash) return undefined
  return {
    display: "/" + slash.name,
    value: "/" + slash.name,
    commandValue: option.value,
    description: option.description ?? option.title,
    aliases: slash.aliases?.map((alias) => "/" + alias),
    onSelect,
  }
}

export function matchesSlashCommand(option: SlashCommandSource, name: string) {
  if (option.enabled === false) return false
  const slash = option.slash
  if (!slash) return false
  const aliases = slash.aliases ?? []
  return slash.name === name || aliases.includes(name)
}
