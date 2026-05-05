import { createConnection } from "node:net"
import {
  BrokerDisconnectInput,
  BrokerDisconnectOutput,
  BrokerEnsureInput,
  BrokerEnsureOutput,
  BrokerListToolsInput,
  BrokerListToolsOutput,
  BrokerMeta,
  BrokerPingInput,
  BrokerPong,
  BrokerReq,
  BrokerRes,
  type BrokerName,
} from "./browser-broker-protocol"

export class BrowserBrokerClient {
  readonly meta: BrokerMeta

  constructor(meta: BrokerMeta) {
    this.meta = meta
  }

  async ping() {
    const res = await this.call("ping", {})
    return BrokerPong.parse(res)
  }

  async ensureConnected(name: BrokerName) {
    const res = await this.call("ensureConnected", { name })
    return BrokerEnsureOutput.parse(res)
  }

  async disconnect(name: BrokerName) {
    const res = await this.call("disconnect", { name })
    return BrokerDisconnectOutput.parse(res)
  }

  async listTools(name: BrokerName) {
    const res = await this.call("listTools", { name })
    return BrokerListToolsOutput.parse(res)
  }

  private async call(
    method: BrokerReq["method"],
    input: BrokerPingInput | BrokerEnsureInput | BrokerDisconnectInput | BrokerListToolsInput,
  ) {
    const meta = BrokerMeta.parse(this.meta)
    const req = BrokerReq.parse({
      token: meta.token,
      method,
      input,
    })
    return new Promise<unknown>((resolve, reject) => {
      const sock = createConnection({
        host: meta.host,
        port: meta.port,
      })
      let buf = ""
      sock.setEncoding("utf8")
      sock.once("error", reject)
      sock.on("data", (chunk: string) => {
        buf += chunk
        const idx = buf.indexOf("\n")
        if (idx < 0) return
        const parsed = BrokerRes.parse(JSON.parse(buf.slice(0, idx)) as unknown)
        sock.end()
        if (!parsed.ok) {
          reject(new Error(parsed.error))
          return
        }
        resolve(parsed.result)
      })
      sock.on("connect", () => {
        sock.write(JSON.stringify(req) + "\n")
      })
    })
  }
}
