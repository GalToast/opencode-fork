import type { CommandOption } from "@tui/component/dialog-command"
import { DialogPlan } from "./dialog-plan"
import { DialogTracker } from "./dialog-tracker"

export function sessionPlanTrackerCommandOptions(sessionID: string): CommandOption[] {
  return [
    {
      title: "Show plan state",
      value: "session.plan",
      category: "Session",
      slash: {
        name: "plan",
      },
      onSelect: (dialog) => {
        dialog.replace(<DialogPlan sessionID={sessionID} />)
      },
    },
    {
      title: "Show tracker",
      value: "session.tracker",
      category: "Session",
      slash: {
        name: "tracker",
        aliases: ["tasks"],
      },
      onSelect: (dialog) => {
        dialog.replace(<DialogTracker sessionID={sessionID} />)
      },
    },
  ]
}
