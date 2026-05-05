import path from 'path'
import { spyOn } from 'bun:test'
import { HarnessGenerate } from './src/harness/generate'
import * as HarnessSessionModule from './src/harness/session'
import { HarnessState } from './src/harness/state'
import { Filesystem } from './src/util/filesystem'
import { tmpdir } from './test/fixture/fixture'

async function withHarnessRoots(fn) {
  await using harness = await tmpdir()
  await using source = await tmpdir()
  const originalHarnessRoot = process.env.OPENCODE_HARNESS_ROOT
  const originalSourceRoot = process.env.OPENCODE_HARNESS_SOURCE_ROOT
  process.env.OPENCODE_HARNESS_ROOT = harness.path
  process.env.OPENCODE_HARNESS_SOURCE_ROOT = source.path
  try {
    await fn({ harnessRoot: harness.path, sourceRoot: source.path })
  } finally {
    if (originalHarnessRoot === undefined) delete process.env.OPENCODE_HARNESS_ROOT
    else process.env.OPENCODE_HARNESS_ROOT = originalHarnessRoot
    if (originalSourceRoot === undefined) delete process.env.OPENCODE_HARNESS_SOURCE_ROOT
    else process.env.OPENCODE_HARNESS_SOURCE_ROOT = originalSourceRoot
  }
}

await withHarnessRoots(async ({ harnessRoot, sourceRoot }) => {
  const firstTarget = 'packages/opencode/src/harness/ambient.ts'
  const secondTarget = 'packages/opencode/src/harness/session.ts'
  await Filesystem.write(path.join(sourceRoot, firstTarget), 'export const ambient = 1\n')
  await Filesystem.write(path.join(sourceRoot, secondTarget), 'export const session = 1\n')
  const proposalID = 'debug_prt_harness_session_start_bonus_retry'
  await HarnessState.replaceProposals([{ id: proposalID, kind:'code_patch', title:'t', confidence:'high', rationale:'r', status:'open', risk:'large', autonomy:'autonomous_patch', expectedFiles:[firstTarget, secondTarget], sensitivePaths:[firstTarget, secondTarget], maxFiles:12, maxChangedLines:6000, allowMove:true, allowDelete:true, requirePriorValidation:true, patchHint:{ summary:'s', files:[firstTarget, secondTarget] } }])
  const validPatch = ['*** Begin Patch', `*** Update File: ${firstTarget}`, '@@', '-export const ambient = 1', '+export const ambient = 2', '*** End Patch', ''].join('\n')
  const sessionSpy = spyOn(HarnessSessionModule, 'runReadOnlyHarnessSession')
    .mockResolvedValueOnce({ raw:['EXPLORE SUMMARY:','- x','FILES:','- '+firstTarget,'INTENT:','- y','RISKS:','- z','NEXT PATCH:','- Update '+firstTarget].join('\n'), sessionID:'ses1', selectedModel:'fixture/steady-coder', routing:{selectedModel:'fixture/steady-coder'} })
    .mockRejectedValueOnce(new Error('Harness patch stalled after 240000ms without visible progress. Last progress: session_start.'))
    .mockRejectedValueOnce(new Error('Harness patch stalled after 240000ms without visible progress. Last progress: session_start.'))
    .mockResolvedValueOnce({ raw: validPatch, sessionID:'ses4', selectedModel:'fixture/steady-coder', routing:{selectedModel:'fixture/steady-coder'} })

  setInterval(() => {
    console.log('tick calls=', sessionSpy.mock.calls.length)
  }, 3000).unref?.()

  const resultPromise = HarnessGenerate.generate({ proposalID })
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('local timeout')), 15000))
  try {
    const result = await Promise.race([resultPromise, timeout])
    console.log('done', result.patchText)
  } catch (error) {
    console.error('ERR', error)
    console.log('calls=', sessionSpy.mock.calls.length)
    for (const [i, call] of sessionSpy.mock.calls.entries()) {
      console.log('call', i, call[0].stage, call[0].model, call[0].timeoutMS)
    }
    const diag2 = path.join(harnessRoot,'.opencode','runtime','harness','review',proposalID,'generated.attempt-2.diagnosis.txt')
    const diag3 = path.join(harnessRoot,'.opencode','runtime','harness','review',proposalID,'generated.attempt-3.diagnosis.txt')
    console.log('diag2 exists', await Filesystem.exists(diag2), 'diag3 exists', await Filesystem.exists(diag3))
  } finally {
    sessionSpy.mockRestore()
  }
})
