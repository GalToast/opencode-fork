import { bootstrap } from "./src/cli/bootstrap"
import { Instance } from "./src/project/instance"
import { Session } from "./src/session"
import { MessageV2 } from "./src/session/message-v2"

const ids = ['ses_31625b8f8ffeVFEHU8pSklJ3m9','ses_316277a9fffei6esKUCjsV04Re']
function preview(text, max=80){return text.length>max?text.slice(0,max)+'...':text}
function textFromParts(parts){return parts.filter((p)=>p.type==='text'&&typeof p.text==='string').map((p)=>p.text).join('').trim()}
await bootstrap(process.cwd(), async () => {
  await Instance.provide({ directory: 'C:/Users/HP/Desktop/Temp while my comp is at the shop', fn: async () => {
    for (const sessionID of ids) {
      try {
        const rows = await Session.messages({ sessionID })
        console.log(JSON.stringify({ sessionID, count: rows.length, rows: await Promise.all(rows.map(async (row)=>({ id: row.info.id, role: row.info.role, parentID: row.info.role==='assistant'?row.info.parentID:undefined, finish: row.info.role==='assistant'?row.info.finish:undefined, completed: row.info.time.completed, text: preview(textFromParts(await MessageV2.parts(row.info.id))) })) )}, null, 2))
      } catch (error) {
        console.log(JSON.stringify({ sessionID, error: error instanceof Error ? error.message : String(error) }, null, 2))
      }
    }
  }})
})
