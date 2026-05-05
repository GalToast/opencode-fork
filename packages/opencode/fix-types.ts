import * as fs from 'fs';
import * as path from 'fs';
import * as cp from 'child_process';
import { globSync } from 'glob';

// Simple fix script for opencode tests and scripts

const testFiles = globSync('test/**/*.ts', { cwd: process.cwd(), absolute: true });
const scriptFiles = globSync('script/**/*.ts', { cwd: process.cwd(), absolute: true });
const srcFiles = globSync('src/**/*.ts', { cwd: process.cwd(), absolute: true });

const filesToFix = [...testFiles, ...scriptFiles, ...srcFiles];

for (const file of filesToFix) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  // Fix context object literals in tool tests:
  // e.g. { sessionID: "session", messageID: "message", ... }
  // we can just append ` as any` to the end of the argument or replace `sessionID: "something"` with `sessionID: "something" as any`
  
  const original = content;

  // Common tool test context setup
  content = content.replace(/sessionID:\s*(['"][^'"]+['"])/g, 'sessionID: $1 as any');
  content = content.replace(/messageID:\s*(['"][^'"]+['"])/g, 'messageID: $1 as any');
  content = content.replace(/providerID:\s*(['"][^'"]+['"])/g, 'providerID: $1 as any');
  content = content.replace(/modelID:\s*(['"][^'"]+['"])/g, 'modelID: $1 as any');
  content = content.replace(/workspaceID:\s*(['"][^'"]+['"])/g, 'workspaceID: $1 as any');

  // For variables like: const sessionId = "..."
  content = content.replace(/const sessionID = (['"][^'"]+['"])/g, 'const sessionID = $1 as any');
  content = content.replace(/const messageID = (['"][^'"]+['"])/g, 'const messageID = $1 as any');
  
  if (content !== original) {
    fs.writeFileSync(file, content);
    console.log(`Updated ${file}`);
  }
}
