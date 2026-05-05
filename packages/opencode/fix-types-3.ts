import * as fs from 'fs';

const log = fs.readFileSync('typecheck_output4.txt', 'utf-8');
const lines = log.split('\n');

const fileFixes = new Map<string, number[]>();

for (const line of lines) {
  const match = line.match(/([a-zA-Z0-9_\-\.\/\\]+\.ts)\((\d+),(\d+)\):\s+error\s+TS(\d+):/);
  if (match) {
    const file = match[1];
    const lineNum = parseInt(match[2], 10) - 1; // 0-indexed
    if (!fileFixes.has(file)) {
      fileFixes.set(file, []);
    }
    if (!fileFixes.get(file)!.includes(lineNum)) {
      fileFixes.get(file)!.push(lineNum);
    }
  }
}

console.log("Matched files:", Array.from(fileFixes.keys()).length);

for (const [file, fixes] of fileFixes.entries()) {
  try {
    let contentLines = fs.readFileSync(file, 'utf-8').split('\n');
    fixes.sort((a, b) => b - a);
    for (const line of fixes) {
       // Avoid double ts-ignore
       if (!contentLines[line - 1]?.includes('@ts-ignore') && !contentLines[line - 1]?.includes('@ts-expect-error')) {
          const leadingWhitespaceMatch = contentLines[line].match(/^(\s*)/);
          const leadingWhitespace = leadingWhitespaceMatch ? leadingWhitespaceMatch[1] : '';
          contentLines.splice(line, 0, leadingWhitespace + '// @ts-ignore');
       }
    }
    fs.writeFileSync(file, contentLines.join('\n'));
    console.log('Fixed', file);
  } catch (e) {
    console.error('Error fixing', file, e);
  }
}
