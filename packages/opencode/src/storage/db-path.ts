import path from "path"
import os from "os"

/**
 * Determines the database path based on platform and environment variables.
 * 
 * Priority:
 * 1. OPENCODE_DB_PATH environment variable (if set)
 * 2. Platform-specific default path:
 *    - Windows: %APPDATA%\opencode\opencode.db
 *    - macOS: ~/Library/Application Support/opencode/opencode.db
 *    - Linux/Unix: ~/.local/share/opencode/opencode.db (XDG compliant)
 * 
 * @returns The resolved database file path
 */
export function getDatabasePath(): string {
  if (process.env.OPENCODE_DB_PATH) {
    return process.env.OPENCODE_DB_PATH
  }

  const home = os.homedir()

  switch (process.platform) {
    case "win32": {
      const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming")
      return path.join(appData, "opencode", "opencode.db")
    }
    case "darwin": {
      return path.join(home, "Library", "Application Support", "opencode", "opencode.db")
    }
    default: {
      const xdgData = process.env.XDG_DATA_HOME || path.join(home, ".local", "share")
      return path.join(xdgData, "opencode", "opencode.db")
    }
  }
}
