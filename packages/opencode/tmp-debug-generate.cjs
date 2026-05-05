const path = require('node:path')
const { spyOn } = require('bun:test')
const HarnessGenerateModule = require('./src/harness/generate.ts')
const HarnessSessionModule = require('./src/harness/session.ts')
const HarnessStateModule = require('./src/harness/state.ts')
const { Filesystem } = require('./src/util/filesystem.ts')
const { withHarnessRoots } = require('./test/harness/setup.ts')

(async () => {
  await withHarnessRoots(async ({ harnessRoot, sourceRoot }) => {
    const firstTarget = 'packages/opencode/src/harness/ambient.ts'
    const secondTarget = 'packages/opencode/src/harness/session.ts'
    await Filesystem.write(path.join(sourceRoot, firstTarget), 'export const ambient = 1\n')
    await Filesystem.write(path.join(sourceRoot, secondTarget), 'export const session = 1\n')
    const proposalID = 'debug_prt_harness_session_start_bonus_retry'
    await HarnessStateModule.HarnessState.replaceProposals([{ id: proposalID, kind:'code_patch', title:'t', confidence:'high', rationale:'r', status:'open', risk:'large', autonomy:'autonomous_patch', expectedFiles:[firstTarget, secondTarget], sensitivePaths:[firstTarget, secondTarget], maxFiles:12, maxChangedLines:6000, allowMove:true, allowDelete:true, requirePriorValidation:true, patchHint:{ summary:'s', files:[firstTarget, secondTarget] } }])
    const validPatch = ['*** Begin Patch', `*** Update File: ${firstTarget}`, '@@', '-export const ambient = 1', '+export const ambient = 2', '*** End Patch', ''].join('\n')
    const sessionSpy = spyOn(HarnessSessionModule, 'runReadOnlyHarnessSession')
      .mockResolvedValueOnce({ raw:['EXPLORE SUMMARY:','- x','FILES:','- '+firstTarget,'INTENT:','- y','RISKS:','- z','NEXT PATCH:','- Update '+firstTarget].join('\n'), sessionID:'ses1', selectedModel:'fixture/steady-coder', routing:{selectedModel:'fixture/steady-coder'} })
      .mockRejectedValueOnce(new Error('Harness patch stalled after 240000ms without visible progress. Last progress: session_start.'))
      .mockRejectedValueOnce(new Error('Harness patch stalled after 240000ms without visible progress. Last progress: session_start.'))
      .mockResolvedValueOnce({ raw: validPatch, sessionID:'ses4', selectedModel:'fixture/steady-coder', routing:{selectedModel:'fixture/steady-coder'} })

    const t = setTimeout(() => {
      console.log('still running after 10s, calls=', sessionSpy.mock.calls.length)
      for (const [i, call] of sessionSpy.mock.calls.entries()) {
        console.log('call', i, call[0].stage, call[0].model, call[0].timeoutMS)
      }
    }, 10000)
    t.unref?.()
    try {
      const result = await HarnessGenerateModule.HarnessGenerate.generate({ proposalID })
      console.log('done', result.patchText)
      console.log('calls=', sessionSpy.mock.calls.length)
      for (const [i, call] of sessionSpy.mock.calls.entries()) {
        console.log('call', i, call[0].stage, call[0].model, call[0].timeoutMS)
      }
    } catch (error) {
      console.error('ERR', error)
    } finally {
      sessionSpy.mockRestore()
    }
  })
})().catch(err => { console.error(err); process.exit(1) })
