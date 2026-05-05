import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { createResource, createMemo } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

export type DialogSkillProps = {
  onSelect: (skill: string) => void
}

type SkillInfo = {
  name: string
  description?: string | null
}

type SkillResponse = {
  data?: SkillInfo[]
}

export function DialogSkill(props: DialogSkillProps) {
  const dialog = useDialog()
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const client: OpencodeClient = useSDK().client
  dialog.setSize("large")

  const [skills] = createResource<SkillInfo[]>(async () => {
    const result = (await client.app.skills()) as unknown as SkillResponse
    return result.data ?? []
  })

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const list = skills() ?? []
    const maxWidth = Math.max(0, ...list.map((s) => s.name.length))
    return list.map((skill) => ({
      title: skill.name.padEnd(maxWidth),
      description: skill.description?.replace(/\s+/g, " ").trim(),
      value: skill.name,
      category: "Skills",
      onSelect: () => {
        props.onSelect(skill.name)
        dialog.clear()
      },
    }))
  })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return <DialogSelect title="Skills" placeholder="Search skills..." options={options()} />
}
