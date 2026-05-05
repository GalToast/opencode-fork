import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync } from "fs"
import { tmpdir } from "../fixture/fixture"
import {
  activeWorkerManifestPath,
  pendingWorkerManifestPath,
  launchNoticeEnv,
  markPendingWorkerActivation,
  promotePendingWorkerActivation,
  readLaunchNotice,
} from "../../src/harness/hotswap"
import { launchUpgradeMessage } from "../../src/harness/ux"
import { Filesystem } from "../../src/util/filesystem"

describe("hotswap module", () => {
  describe("activeWorkerManifestPath", () => {
    it("returns a valid path string", () => {
      const path = activeWorkerManifestPath()
      expect(typeof path).toBe("string")
      expect(path.length).toBeGreaterThan(0)
    })

    it("path ends with expected filename", () => {
      const path = activeWorkerManifestPath()
      expect(path.endsWith("active.json")).toBe(true)
    })
  })

  describe("pendingWorkerManifestPath", () => {
    it("returns a valid path string", () => {
      const path = pendingWorkerManifestPath()
      expect(typeof path).toBe("string")
      expect(path.length).toBeGreaterThan(0)
    })

    it("path ends with expected filename", () => {
      const path = pendingWorkerManifestPath()
      expect(path.endsWith("pending.json")).toBe(true)
    })

    it("returns different path than active", () => {
      const active = activeWorkerManifestPath()
      const pending = pendingWorkerManifestPath()
      expect(pending).not.toBe(active)
    })
  })

  describe("launchNoticeEnv", () => {
    it("returns expected env var name", () => {
      const env = launchNoticeEnv()
      expect(env).toBe("OPENCODE_HARNESS_UPGRADE_NOTICE")
    })
  })
})

describe("hotswap fixture coverage", () => {
  // Controlled harness root via env var; each test gets an isolated tmpdir.
  let harnessRoot: string
  let originalHarnessRoot: string | undefined
  let originalWorkerGen: string | undefined
  let originalNotice: string | undefined

  beforeEach(async () => {
    const tmp = await tmpdir()
    harnessRoot = tmp.path
    originalHarnessRoot = process.env.OPENCODE_HARNESS_ROOT
    originalWorkerGen = process.env.OPENCODE_HARNESS_WORKER_GENERATION
    originalNotice = process.env[launchNoticeEnv()]
    process.env.OPENCODE_HARNESS_ROOT = harnessRoot
    // Clear any stale generation/notice from promotion in prior tests
    delete process.env.OPENCODE_HARNESS_WORKER_GENERATION
    delete process.env[launchNoticeEnv()]
  })

  afterEach(() => {
    if (originalHarnessRoot !== undefined) {
      process.env.OPENCODE_HARNESS_ROOT = originalHarnessRoot
    } else {
      delete process.env.OPENCODE_HARNESS_ROOT
    }
    if (originalWorkerGen !== undefined) {
      process.env.OPENCODE_HARNESS_WORKER_GENERATION = originalWorkerGen
    } else {
      delete process.env.OPENCODE_HARNESS_WORKER_GENERATION
    }
    if (originalNotice !== undefined) {
      process.env[launchNoticeEnv()] = originalNotice
    } else {
      delete process.env[launchNoticeEnv()]
    }
  })

  describe("markPendingWorkerActivation", () => {
    it("writes a pending.json file to the harness worker directory", async () => {
      const manifest = { executionID: "pending-write-test", updatedAt: Date.now() }
      const target = await markPendingWorkerActivation(manifest)
      expect(target).toBe(pendingWorkerManifestPath())
      expect(existsSync(target)).toBe(true)
    })

    it("persists the manifest content verbatim in pending.json", async () => {
      const manifest = {
        executionID: "pending-content-test",
        proposalID: "prop-123",
        updatedAt: 1_700_000_000_000,
        title: "Test Harness",
        detail: "Test detail text",
      }
      await markPendingWorkerActivation(manifest)
      const loaded = await Filesystem.readJson(pendingWorkerManifestPath())
      expect(loaded).toEqual(manifest)
    })

    it("overwrites a previously written pending.json", async () => {
      await markPendingWorkerActivation({ executionID: "first", updatedAt: 1 })
      await markPendingWorkerActivation({ executionID: "second", updatedAt: 2 })
      const loaded = await Filesystem.readJson<{ executionID: string }>(pendingWorkerManifestPath())
      expect(loaded.executionID).toBe("second")
    })
  })

  describe("promotePendingWorkerActivation", () => {
    it("promotes pending manifest to active.json and removes pending", async () => {
      const manifest = { executionID: "promote-test", updatedAt: Date.now() }
      await markPendingWorkerActivation(manifest)
      const result = await promotePendingWorkerActivation()
      expect(result?.executionID).toBe("promote-test")
      expect(existsSync(pendingWorkerManifestPath())).toBe(false)
      expect(existsSync(activeWorkerManifestPath())).toBe(true)
    })

    it("active.json contains identical manifest content", async () => {
      const manifest = {
        executionID: "active-content-test",
        proposalID: "prop-456",
        updatedAt: 1_700_000_001_000,
        title: "Promoted Harness",
        detail: "Promoted detail",
      }
      await markPendingWorkerActivation(manifest)
      await promotePendingWorkerActivation()
      const loaded = await Filesystem.readJson(activeWorkerManifestPath())
      expect(loaded).toEqual(manifest)
    })

    it("returns undefined when no pending manifest exists", async () => {
      const result = await promotePendingWorkerActivation()
      expect(result).toBeUndefined()
    })
  })

  describe("malformed pending.json cleanup", () => {
    it("removes pending.json when it contains invalid JSON and does not create active.json", async () => {
      // Write garbage directly to the pending path using the filesystem module
      await Filesystem.write(pendingWorkerManifestPath(), "{ this is not json")
      const result = await promotePendingWorkerActivation()
      expect(result).toBeUndefined()
      expect(existsSync(pendingWorkerManifestPath())).toBe(false)
      expect(existsSync(activeWorkerManifestPath())).toBe(false)
    })

    it("removes pending.json when it is empty and does not create active.json", async () => {
      await Filesystem.write(pendingWorkerManifestPath(), "")
      const result = await promotePendingWorkerActivation()
      expect(result).toBeUndefined()
      expect(existsSync(pendingWorkerManifestPath())).toBe(false)
      expect(existsSync(activeWorkerManifestPath())).toBe(false)
    })
  })

  describe("promotePendingWorkerActivation env generation", () => {
    it("sets OPENCODE_HARNESS_WORKER_GENERATION to the manifest executionID", async () => {
      const manifest = { executionID: "env-gen-test", updatedAt: Date.now() }
      await markPendingWorkerActivation(manifest)
      await promotePendingWorkerActivation()
      expect(process.env.OPENCODE_HARNESS_WORKER_GENERATION).toBe("env-gen-test")
    })

    it("sets OPENCODE_HARNESS_UPGRADE_NOTICE with a JSON LaunchNotice", async () => {
      const manifest = {
        executionID: "notice-env-test",
        updatedAt: Date.now(),
        title: "My Title",
        detail: "My Detail",
      }
      await markPendingWorkerActivation(manifest)
      await promotePendingWorkerActivation()
      const raw = process.env[launchNoticeEnv()]
      expect(raw).toBeDefined()
      const notice = JSON.parse(raw!)
      expect(notice.executionID).toBe("notice-env-test")
      expect(notice.title).toBe("Harness Upgrade Active")
    })

    it("readLaunchNotice consumes the env var and returns the parsed LaunchNotice", async () => {
      const manifest = {
        executionID: "read-notice-test",
        updatedAt: Date.now(),
        title: "Read Notice Title",
        detail: "Read Notice Detail",
      }
      await markPendingWorkerActivation(manifest)
      await promotePendingWorkerActivation()
      const notice = readLaunchNotice()
      expect(notice).toBeDefined()
      expect(notice!.executionID).toBe("read-notice-test")
      expect(notice!.title).toBe("Harness Upgrade Active")
      // Second call returns undefined (already consumed)
      expect(readLaunchNotice()).toBeUndefined()
    })

    it("OPENCODE_HARNESS_UPGRADE_NOTICE contains the default message when detail is absent", async () => {
      const manifest = { executionID: "no-detail-test", updatedAt: Date.now() }
      await markPendingWorkerActivation(manifest)
      await promotePendingWorkerActivation()
      const raw = process.env[launchNoticeEnv()]!
      const notice = JSON.parse(raw)
      expect(notice.message).toBe(launchUpgradeMessage(undefined))
    })
  })

  describe("malformed pending edge cases", () => {
    it("leaves existing active.json intact when promoting a malformed pending", async () => {
      // Pre-write an active.json
      await Filesystem.writeJson(activeWorkerManifestPath(), {
        executionID: "pre-existing-active",
        updatedAt: 1,
      })
      // Write garbage as pending
      await Filesystem.write(pendingWorkerManifestPath(), "not json at all {{{")
      const result = await promotePendingWorkerActivation()
      expect(result).toBeUndefined()
      // active.json must not have been touched
      const active = await Filesystem.readJson<{ executionID: string }>(activeWorkerManifestPath())
      expect(active.executionID).toBe("pre-existing-active")
    })

    it("pending.json path resolves under the tmpdir harness root", async () => {
      const manifest = { executionID: "path-root-test", updatedAt: Date.now() }
      await markPendingWorkerActivation(manifest)
      const pendingPath = pendingWorkerManifestPath()
      expect(pendingPath.startsWith(harnessRoot)).toBe(true)
      expect(pendingPath.endsWith("pending.json")).toBe(true)
    })
  })
})
