/**
 * Regression guard for the dsh 0.1.7 entry-config migration: every field the
 * `Config` schema marks `.volatile()` reaches the plugin as a stable reference
 * (`{ get() }`) instead of a plain value. Reading them raw dropped the whole
 * stored document (per-model provider order/active, modelSort, toggles,
 * recentlyUsed) and the next persist overwrote it with catalog defaults.
 */
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '@deepseek-ai/cordis'
import { RouterConfigSchema } from '../src/server/service'
import { derefConfig, normalizeConfig } from '../src/shared/config'

/** What one `dsh >= 0.1.7` apply() receives for the given raw entry config. */
function loaderConfig(raw: Record<string, unknown>): unknown {
  return resolveConfig({ Config: RouterConfigSchema } as never, raw)
}

const STORED = {
  models: { 'grok-4.6': { order: ['cpa', 'command-code'], active: 'command-code' } },
  showQuickSwitch: false,
  ignoreModelIdPrefix: false,
  modelSort: 'recent',
  modelOrder: ['grok-4.6'],
  recentlyUsed: { 'grok-4.6': 1234 },
}

describe('normalizeConfig over a volatile entry config', () => {
  it('receives references from the loader and still keeps every field', () => {
    const resolved = loaderConfig(STORED)
    // The loader hands over references, not values (the bug's precondition).
    expect(JSON.stringify(resolved)).toBe(
      '{"models":{},"showQuickSwitch":{},"ignoreModelIdPrefix":{},"modelSort":{},"modelOrder":{},"recentlyUsed":{}}',
    )

    const config = normalizeConfig(resolved)
    expect(config).toEqual(STORED)
  })

  it('passes plain documents through unchanged', () => {
    expect(normalizeConfig(STORED)).toEqual(STORED)
  })

  it('dereferences a reference nested as the whole document', () => {
    const doc = { get: () => STORED }
    expect(normalizeConfig(doc)).toEqual(STORED)
  })

  it('falls back to defaults for a missing or malformed document', () => {
    const defaults = { models: {}, showQuickSwitch: true, ignoreModelIdPrefix: true, modelSort: 'custom', modelOrder: [], recentlyUsed: {} }
    expect(normalizeConfig(undefined)).toEqual(defaults)
    expect(normalizeConfig('nonsense')).toEqual(defaults)
    expect(normalizeConfig({ get: () => undefined })).toEqual(defaults)
  })

  it('derefConfig leaves arrays and scalars alone', () => {
    expect(derefConfig(['a', 'b'])).toEqual(['a', 'b'])
    expect(derefConfig(7)).toBe(7)
  })
})
