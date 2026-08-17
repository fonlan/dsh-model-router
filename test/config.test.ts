import { describe, expect, it } from 'vitest'
import {
  displayProvider,
  initialConfigFor,
  mergeModels,
  normalizeConfig,
  resolveActive,
  setActive,
  setOrder,
  syncConfig,
  type ProviderInfo,
  type RouterConfigShape,
} from '../src/shared/config'

function provider(id: string, models: Array<[string, string]>): ProviderInfo {
  return {
    id,
    models: models.map(([mid, name]) => ({ id: mid, name })),
  }
}

const opencode = provider('opencode-go', [
  ['deepseek-v4-flash', 'DeepSeek V4 Flash'],
  ['qwen3.7-max', 'Qwen3.7 Max'],
  ['glm-5.2', 'GLM-5.2'],
])
const official = provider('deepseek-official', [
  ['deepseek-v4-flash', 'DeepSeek V4 Flash'],
  ['deepseek-v4-pro', 'DeepSeek V4 Pro'],
])
const mtplx = provider('mtplx', [['automatosx-ax', 'Qwen3.8 27B MTPLX']])

describe('mergeModels', () => {
  it('merges strictly by model id across providers', () => {
    const merged = mergeModels([opencode, official, mtplx])
    const ids = merged.map(m => m.id)
    expect(ids).toEqual(['deepseek-v4-flash', 'qwen3.7-max', 'glm-5.2', 'deepseek-v4-pro', 'automatosx-ax'])
    const flash = merged.find(m => m.id === 'deepseek-v4-flash')!
    expect(flash.providers.map(p => p.provider)).toEqual(['opencode-go', 'deepseek-official'])
  })

  it('keeps same-id models apart when ids differ', () => {
    const a = provider('a', [['same-name', 'X']])
    const b = provider('b', [['same-name', 'X']])
    // same id in two providers merges; different ids never do even with same name
    const merged = mergeModels([a, b])
    expect(merged).toHaveLength(1)
    expect(merged[0].providers).toHaveLength(2)
  })
})

describe('displayProvider', () => {
  it('follows the active provider and falls back to the first', () => {
    const merged = mergeModels([opencode, official]).find(m => m.id === 'deepseek-v4-flash')!
    expect(displayProvider(merged, 'deepseek-official')!.provider).toBe('deepseek-official')
    expect(displayProvider(merged, undefined)!.provider).toBe('opencode-go')
    expect(displayProvider(merged, 'missing')!.provider).toBe('opencode-go')
  })
})

describe('initialConfigFor / resolveActive', () => {
  it('initial config puts the first provider first and active', () => {
    expect(initialConfigFor(['a', 'b'])).toEqual({ order: ['a', 'b'], active: 'a' })
    expect(initialConfigFor([])).toBeNull()
  })

  it('resolves stored active, then first remaining order entry, then catalog head', () => {
    const cfg: RouterConfigShape = {
      showQuickSwitch: true,
      models: {
        m1: { order: ['a', 'b'], active: 'b' },
        m2: { order: ['a', 'b'], active: 'gone' },
        m3: { order: ['gone1', 'gone2'], active: 'gone1' },
      },
    }
    expect(resolveActive(cfg, 'm1', ['a', 'b'])).toBe('b')
    expect(resolveActive(cfg, 'm2', ['b'])).toBe('b')
    expect(resolveActive(cfg, 'm3', ['x'])).toBe('x')
    expect(resolveActive(cfg, 'm4', ['y', 'z'])).toBe('y')
    expect(resolveActive(cfg, 'm1', [])).toBeNull()
  })
})

describe('syncConfig', () => {
  const base: RouterConfigShape = { showQuickSwitch: true, models: { m1: { order: ['a', 'b'], active: 'b' } } }

  it('creates initial config for unknown models', () => {
    const { models, changed } = syncConfig(base, 'm2', ['x', 'y'])
    expect(changed).toBe(true)
    expect(models.m2).toEqual({ order: ['x', 'y'], active: 'x' })
  })

  it('prunes vanished providers and repairs a vanished active', () => {
    const { models, changed } = syncConfig(base, 'm1', ['a', 'c'])
    expect(changed).toBe(true)
    expect(models.m1).toEqual({ order: ['a', 'c'], active: 'a' })
  })

  it('appends new providers without touching active', () => {
    const { models, changed } = syncConfig(base, 'm1', ['a', 'b', 'c'])
    expect(changed).toBe(true)
    expect(models.m1).toEqual({ order: ['a', 'b', 'c'], active: 'b' })
  })

  it('is a no-op when nothing changed', () => {
    const { models, changed } = syncConfig(base, 'm1', ['a', 'b'])
    expect(changed).toBe(false)
    expect(models).toEqual(base.models)
  })

  it('removes the entry when the catalog is empty', () => {
    const { models, changed } = syncConfig(base, 'm1', [])
    expect(changed).toBe(true)
    expect(models.m1).toBeUndefined()
  })
})

describe('setActive / setOrder', () => {
  const cfg: RouterConfigShape = { showQuickSwitch: true, models: { m1: { order: ['a', 'b', 'c'], active: 'a' } } }

  it('switches active and preserves order', () => {
    const { models, changed } = setActive(cfg, 'm1', 'c', ['a', 'b', 'c'])
    expect(changed).toBe(true)
    expect(models.m1).toEqual({ order: ['a', 'b', 'c'], active: 'c' })
  })

  it('rejects providers outside the catalog', () => {
    expect(() => setActive(cfg, 'm1', 'zzz', ['a', 'b', 'c'])).toThrow()
  })

  it('reorders and preserves active', () => {
    const { models, changed } = setOrder(cfg, 'm1', ['c', 'b', 'a'], ['a', 'b', 'c'])
    expect(changed).toBe(true)
    expect(models.m1).toEqual({ order: ['c', 'b', 'a'], active: 'a' })
  })

  it('fills missing catalog entries at the end of a reorder', () => {
    const { models } = setOrder(cfg, 'm1', ['c'], ['a', 'b', 'c'])
    expect(models.m1.order).toEqual(['c', 'a', 'b'])
  })
})

describe('normalizeConfig', () => {
  it('tolerates junk and repairs broken entries', () => {
    expect(normalizeConfig(null).models).toEqual({})
    expect(normalizeConfig(null).showQuickSwitch).toBe(true)
    expect(normalizeConfig({ models: { m1: { order: [1, 'a'], active: 2 } } }).models.m1)
      .toEqual({ order: ['a'], active: 'a' })
  })

  it('defaults the quick-switch toggle on and honors explicit false', () => {
    expect(normalizeConfig({ models: {} }).showQuickSwitch).toBe(true)
    expect(normalizeConfig({ models: {}, showQuickSwitch: false }).showQuickSwitch).toBe(false)
    expect(normalizeConfig({ models: {}, showQuickSwitch: true }).showQuickSwitch).toBe(true)
  })
})
