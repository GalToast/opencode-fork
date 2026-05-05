import { tmpdir } from "./test/fixture/fixture"
import { Instance } from "./src/project/instance"
import { SchedulerControl } from "./src/scheduler/control-plane"

const tmp = await tmpdir({git:true, init: async (dir)=>{
  await Bun.write(`${dir}/opencode.json`, JSON.stringify({
    $schema: "https://opencode.ai/config.json",
    experimental: {
      orchestration: {global_scheduler: {
        enabled: true,
        lane_concurrency: {user_ingress:1},
        aging_ms: 100,
        fairness_penalty: 1,
      }}
    }
  }))
}})

await Instance.provide({directory: tmp.path, fn: async ()=>{
  const order: string[] = []
  const waits = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
  await SchedulerControl.setLanePaused("user_ingress", true)
  for (let i=1;i<=3;i++) {
    await SchedulerControl.submit({
      kind: "command",
      lane: "user_ingress",
      priority: "normal",
      sessionID: `a${i}`,
      supervisorSessionID: "rootA",
      description: `a${i}`,
      waitForResult: false,
      run: async ()=>{ order.push(`a${i}`) },
    })
  }
  await SchedulerControl.submit({
    kind: "command",
    lane: "user_ingress",
    priority: "normal",
    sessionID: "b1",
    supervisorSessionID: "rootB",
    description: "b1",
    waitForResult: false,
    run: async ()=>{ order.push("b1") }
  })
  await SchedulerControl.setLanePaused("user_ingress", false)
  await Bun.sleep(1500)
  console.log(JSON.stringify(order))
}})
