import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ROUTING_SUITE_PRESET_FILES,
  ROUTING_SUITE_SOURCE,
  routingSuitePresetUrl,
} from './sync-routing-suite-preset.mjs'

test('routing-suite pins the latest suite submodule and downloads the current preset layout', () => {
  assert.equal(ROUTING_SUITE_SOURCE.suiteCommit, 'a09eb0ade28e6ec3b8e5eb22985a14f6bfa1fbe5')
  assert.equal(ROUTING_SUITE_SOURCE.presetCommit, 'eff787e95132d6c7104214542104a84d656b497e')
  assert.equal(ROUTING_SUITE_SOURCE.presetPath, 'preset/router-standard')
  assert.match(routingSuitePresetUrl('router-bootstrap-v1.mjs'), /\/preset\/router-standard\/router-bootstrap-v1\.mjs$/)
  assert.deepEqual([...ROUTING_SUITE_PRESET_FILES], [
    'agent.cordis.yml',
    'preset.yml',
    'router-bootstrap-v1.mjs',
    'router-bootstrap.mjs',
    'router-core.mjs',
  ])
})
