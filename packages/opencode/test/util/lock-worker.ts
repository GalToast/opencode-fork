import { Lock } from "../../src/util/lock"

const [, , mode, key, readyFile, arg4, arg5] = process.argv

if (!mode || !key || !readyFile) {
  throw new Error("usage: lock-worker.ts <read|write|churn> <key> <ready-file> [hold-ms|count] [hold-ms]")
}

if (mode === "churn") {
  const count = Number(arg4 ?? "120")
  const holdMS = Number(arg5 ?? "1")
  await Bun.write(readyFile, "ready")
  for (let index = 0; index < count; index++) {
    const lease = await (index % 9 === 0 ? Lock.write(key) : Lock.read(key))
    try {
      if (holdMS > 0) await Bun.sleep(holdMS)
    } finally {
      lease[Symbol.dispose]()
    }
  }
} else {
  const holdMS = Number(arg4 ?? "250")
  const lease = mode === "read" ? await Lock.read(key) : await Lock.write(key)

  try {
    await Bun.write(readyFile, "ready")
    await Bun.sleep(holdMS)
  } finally {
    lease[Symbol.dispose]()
  }
}
