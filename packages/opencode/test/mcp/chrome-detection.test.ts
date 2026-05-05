import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { ChromeInstancePool } from '../../src/mcp/chrome-instance-pool'
import { accessSync } from 'fs'
import { execSync } from 'child_process'

mock.module('fs', () => ({
  ...require('fs'),
  accessSync: mock(),
  mkdir: mock(),
  rm: mock(),
}))

mock.module('child_process', () => ({
  ...require('child_process'),
  execSync: mock(),
}))

mock.module('fs/promises', () => ({
  ...require('fs/promises'),
  mkdir: mock(),
  rm: mock(),
}))

describe('ChromeInstancePool - Chrome Detection', () => {
  let originalChromePath: string | undefined
  let originalProgramFiles: string | undefined
  let originalProgramFilesX86: string | undefined
  let originalLocalAppData: string | undefined

beforeEach(() => {
  originalChromePath = process.env.OPENCODE_CHROME_PATH
  originalProgramFiles = process.env.PROGRAMFILES
  originalProgramFilesX86 = process.env['PROGRAMFILES(X86)']
  originalLocalAppData = process.env.LOCALAPPDATA

  ;(accessSync as any).mock.calls.length = 0
  ;(execSync as any).mock.calls.length = 0
})

  afterEach(() => {
    if (originalChromePath !== undefined) {
      process.env.OPENCODE_CHROME_PATH = originalChromePath
    } else {
      delete process.env.OPENCODE_CHROME_PATH
    }
    if (originalProgramFiles) process.env.PROGRAMFILES = originalProgramFiles
    if (originalProgramFilesX86) process.env['PROGRAMFILES(X86)'] = originalProgramFilesX86
    if (originalLocalAppData) process.env.LOCALAPPDATA = originalLocalAppData
  })

  describe('Custom path override (OPENCODE_CHROME_PATH)', () => {
    it('uses custom path when environment variable is set and file exists', () => {
      const customPath = 'C:\\custom\\chrome\\chrome.exe'
      process.env.OPENCODE_CHROME_PATH = customPath
      ;(accessSync as any).mockImplementation(() => undefined)

      const pool = new ChromeInstancePool()
      const detectChromePath = (pool as any).detectChromePath.bind(pool)
      const result = detectChromePath()

      expect(result).toBe(customPath)
      expect((accessSync as any).mock.calls).toContainEqual([customPath])
    })

    it('throws error when custom path is set but file does not exist', () => {
      const customPath = 'C:\\nonexistent\\chrome.exe'
      process.env.OPENCODE_CHROME_PATH = customPath
      ;(accessSync as any).mockImplementation(() => {
        throw new Error('File not found')
      })

      const pool = new ChromeInstancePool()
      const detectChromePath = (pool as any).detectChromePath.bind(pool)

      expect(() => detectChromePath()).toThrow(
        `Custom Chrome path not found: ${customPath}`
      )
    })
  })

  describe('Windows PATH detection', () => {
    it('uses chrome.exe from PATH when available on Windows', () => {
      delete process.env.OPENCODE_CHROME_PATH
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32' })
      ;(execSync as any).mockImplementation(() => Buffer.from('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'))

      const pool = new ChromeInstancePool()
      const detectChromePath = (pool as any).detectChromePath.bind(pool)
      const result = detectChromePath()

      expect(result).toBe('chrome.exe')
      expect((execSync as any).mock.calls).toContainEqual(['where chrome.exe', { stdio: 'ignore' }])

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('falls back to common paths when chrome.exe not in PATH on Windows', () => {
      delete process.env.OPENCODE_CHROME_PATH
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32' })
      ;(execSync as any).mockImplementation(() => {
        throw new Error('Not found')
      })
      ;(accessSync as any).mockImplementation((path: string) => {
        if (path.includes('Program Files (x86)')) {
          return undefined
        }
        throw new Error('File not found')
      })

      const pool = new ChromeInstancePool()
      const detectChromePath = (pool as any).detectChromePath.bind(pool)
      const result = detectChromePath()

      expect(result).toContain('Program Files (x86)')
      expect(result).toContain('chrome.exe')

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('checks all common Windows installation paths in order', () => {
      delete process.env.OPENCODE_CHROME_PATH
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32' })
      process.env.PROGRAMFILES = 'C:\\Program Files'
      process.env['PROGRAMFILES(X86)'] = 'C:\\Program Files (x86)'
      process.env.LOCALAPPDATA = 'C:\\Users\\Test\\AppData\\Local'
      
      ;(execSync as any).mockImplementation(() => {
        throw new Error('Not found')
      })
      
      const foundPath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      ;(accessSync as any).mockImplementation((path: string) => {
        if (path === foundPath) {
          return undefined
        }
        throw new Error('File not found')
      })

      const pool = new ChromeInstancePool()
      const detectChromePath = (pool as any).detectChromePath.bind(pool)
      const result = detectChromePath()

      expect(result).toBe(foundPath)
      expect((accessSync as any).mock.calls.length).toBe(1)
      expect((accessSync as any).mock.calls[0]).toEqual([foundPath])

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('throws descriptive error when Chrome not found on Windows', () => {
      delete process.env.OPENCODE_CHROME_PATH
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32' })
      
      ;(execSync as any).mockImplementation(() => {
        throw new Error('Not found')
      })
      ;(accessSync as any).mockImplementation(() => {
        throw new Error('File not found')
      })

      const pool = new ChromeInstancePool()
      const detectChromePath = (pool as any).detectChromePath.bind(pool)

      expect(() => detectChromePath()).toThrow(
        'Chrome not found on Windows. Install Chrome or set OPENCODE_CHROME_PATH environment variable to the chrome.exe path.'
      )

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })
  })

  describe('Unix PATH detection', () => {
    it('uses default macOS path', () => {
      delete process.env.OPENCODE_CHROME_PATH
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'darwin' })

      const pool = new ChromeInstancePool()
      const detectChromePath = (pool as any).detectChromePath.bind(pool)
      const result = detectChromePath()

      expect(result).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('uses default Linux path', () => {
      delete process.env.OPENCODE_CHROME_PATH
      const originalPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'linux' })

      const pool = new ChromeInstancePool()
      const detectChromePath = (pool as any).detectChromePath.bind(pool)
      const result = detectChromePath()

      expect(result).toBe('google-chrome')

      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })
  })
})
