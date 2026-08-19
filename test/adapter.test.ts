import { describe, expect, it } from 'vitest'
import type { LlmRuntime, LlmResolvedModelInfo, GenerateOptions } from '@deepseek-ai/dsh-llm'
import { ModelRouterAdapter, routeFor, type RouterFacts } from '../src/server/adapter'
import { mergeModels, type MergedModel, type ProviderInfo, type RouterConfigShape } from '../src/shared/config'

function provider(id: string, models: Array<[string, string]>): ProviderInfo {
  return {
    id,
    models: models.map(([mid, name]) => ({ id: mid, name })),
  }
}

function facts(
  models: MergedModel[],
  config: RouterConfigShape = { models: {}, showQuickSwitch: true, ignoreModelIdPrefix: true },
): RouterFacts {
  const byId = new Map(models.map(m => [m.id, m]))
  return {
    catalog: () => ({ models, byId }),
    config: () => config,
    providerNames: () => new Map([['a', 'Provider A'], ['b', 'Provider B']]),
    llm: () => {
      throw new Error('unused')
    },
    noteModelUsed: () => {},
  }
}

function merged(id: string, ...providers: string[]): MergedModel {
  return {
    id,
    providers: providers.map(p => ({ provider: p, id, name: `${id}@${p}` })),
  }
}

describe('routeFor', () => {
  it('resolves stored active, then order head, then catalog head', () => {
    const f = facts([merged('m1', 'a', 'b')], {
      showQuickSwitch: true,
      ignoreModelIdPrefix: true,
      models: { m1: { order: ['b', 'a'], active: 'b' } },
    })
    expect(routeFor(f, 'm1')).toEqual({ provider: 'b' })

    const f2 = facts([merged('m1', 'a', 'b')], {
      showQuickSwitch: true,
      ignoreModelIdPrefix: true,
      models: { m1: { order: ['b', 'a'], active: 'gone' } },
    })
    expect(routeFor(f2, 'm1')).toEqual({ provider: 'b' })

    const f3 = facts([merged('m1', 'a', 'b')])
    expect(routeFor(f3, 'm1')).toEqual({ provider: 'a' })

    expect(routeFor(f, 'unknown')).toBeNull()
  })

  it('matches a prefixed incoming id to the merged model when the flag is on', () => {
    const [flash] = mergeModels([
      provider('a', [['deepseek-v4-flash', 'Flash']]),
      provider('b', [['deepseek/deepseek-v4-flash', 'Flash']]),
    ], { ignorePrefix: true })
    const f = facts([flash], {
      showQuickSwitch: true,
      ignoreModelIdPrefix: true,
      models: { 'deepseek-v4-flash': { order: ['a', 'b'], active: 'b' } },
    })
    expect(routeFor(f, 'deepseek/deepseek-v4-flash')).toEqual({ provider: 'b' })
    expect(routeFor(f, 'deepseek-v4-flash')).toEqual({ provider: 'b' })
  })

  it('does not strip incoming ids when the flag is off', () => {
    const f = facts([merged('m1', 'a')], { models: {}, showQuickSwitch: true, ignoreModelIdPrefix: false })
    expect(routeFor(f, 'm1')).toEqual({ provider: 'a' })
    expect(routeFor(f, 'vendor/m1')).toBeNull()
  })
})

describe('ModelRouterAdapter.listModels', () => {
  it('advertises merged models with display name and active-provider badge', async () => {
    const adapter = new ModelRouterAdapter(facts(
      [merged('m1', 'a', 'b'), merged('m2', 'a')],
      {
        showQuickSwitch: true,
        ignoreModelIdPrefix: true,
        models: { m1: { order: ['a', 'b'], active: 'b' } },
      },
    ))
    const listed = await adapter.listModels('model-router')
    expect(listed).toEqual([
      { provider: 'model-router', id: 'm1', name: 'm1@b', description: 'via Provider B' },
      { provider: 'model-router', id: 'm2', name: 'm2@a', description: 'via Provider A' },
    ])
  })

  it('skips models with no providers', async () => {
    const adapter = new ModelRouterAdapter(facts([merged('m1')]))
    await expect(adapter.listModels('model-router')).resolves.toEqual([])
  })
})

describe('ModelRouterAdapter.resolveModel', () => {
  it('delegates metadata to the active provider and retags provider', async () => {
    const delegate: LlmResolvedModelInfo = {
      provider: 'a',
      id: 'm1',
      name: 'm1@a',
      context: { contextWindow: 128000 },
    }
    const f = facts([merged('m1', 'a', 'b')], {
      showQuickSwitch: true,
      ignoreModelIdPrefix: true,
      models: { m1: { order: ['a', 'b'], active: 'a' } },
    })
    const llm = {
      resolveModelInfo: async (provider: string, model: string) => {
        expect(provider).toBe('a')
        expect(model).toBe('m1')
        return delegate
      },
    } as unknown as LlmRuntime
    const adapter = new ModelRouterAdapter({ ...f, llm: () => llm })
    const resolved = await adapter.resolveModel('model-router', 'm1')
    expect(resolved.provider).toBe('model-router')
    expect(resolved.id).toBe('m1')
    expect(resolved.context).toEqual({ contextWindow: 128000 })
  })

  it('delegates with the raw local id and normalizes the resolved id', async () => {
    const [flash] = mergeModels([
      provider('a', [['deepseek-v4-flash', 'Flash A']]),
      provider('b', [['deepseek/deepseek-v4-flash', 'Flash B']]),
    ], { ignorePrefix: true })
    const f = facts([flash], {
      showQuickSwitch: true,
      ignoreModelIdPrefix: true,
      models: { 'deepseek-v4-flash': { order: ['a', 'b'], active: 'b' } },
    })
    const delegate: LlmResolvedModelInfo = {
      provider: 'b',
      id: 'deepseek/deepseek-v4-flash',
      name: 'Flash B',
    }
    const llm = {
      resolveModelInfo: async (provider: string, model: string) => {
        expect(provider).toBe('b')
        expect(model).toBe('deepseek/deepseek-v4-flash')
        return delegate
      },
    } as unknown as LlmRuntime
    const adapter = new ModelRouterAdapter({ ...f, llm: () => llm })
    const resolved = await adapter.resolveModel('model-router', 'deepseek/deepseek-v4-flash')
    expect(resolved.provider).toBe('model-router')
    expect(resolved.id).toBe('deepseek-v4-flash')
    expect(resolved.name).toBe('Flash B')
  })

  it('throws NO_ADAPTER for unserved models', async () => {
    const adapter = new ModelRouterAdapter(facts([]))
    await expect(adapter.resolveModel('model-router', 'nope')).rejects.toMatchObject({ code: 'NO_ADAPTER' })
  })
})

describe('ModelRouterAdapter.stream', () => {
  it('rewrites the provider and yields the real adapter stream', async () => {
    const calls: string[] = []
    const f = facts([merged('m1', 'a', 'b')], {
      showQuickSwitch: true,
      ignoreModelIdPrefix: true,
      models: { m1: { order: ['a', 'b'], active: 'b' } },
    })
    const llm = {
      stream: (options: GenerateOptions) => {
        calls.push(options.provider)
        return (async function * chunks() {
          yield { type: 'finish', reason: 'stop' } as const
        })()
      },
    } as unknown as LlmRuntime
    const adapter = new ModelRouterAdapter({ ...f, llm: () => llm })
    const options: GenerateOptions = {
      provider: 'model-router',
      model: 'm1',
      messages: [],
    }
    const chunks: unknown[] = []
    for await (const chunk of adapter.stream(options)) chunks.push(chunk)
    expect(calls).toEqual(['b'])
    expect(chunks).toEqual([{ type: 'finish', reason: 'stop' }])
    // the caller's options object is not mutated (loop-built requests are frozen)
    expect(options.provider).toBe('model-router')
  })

  it('rewrites the model to the active provider raw local id', async () => {
    const [flash] = mergeModels([
      provider('a', [['deepseek-v4-flash', 'Flash A']]),
      provider('b', [['deepseek/deepseek-v4-flash', 'Flash B']]),
    ], { ignorePrefix: true })
    const f = facts([flash], {
      showQuickSwitch: true,
      ignoreModelIdPrefix: true,
      models: { 'deepseek-v4-flash': { order: ['a', 'b'], active: 'b' } },
    })
    const delegated: GenerateOptions[] = []
    const llm = {
      stream: (options: GenerateOptions) => {
        delegated.push(options)
        return (async function * chunks() {
          yield { type: 'finish', reason: 'stop' } as const
        })()
      },
    } as unknown as LlmRuntime
    const adapter = new ModelRouterAdapter({ ...f, llm: () => llm })
    const chunks: unknown[] = []
    // caller sends the prefixed raw id; delegation must use the active
    // provider's raw local id and the router provider
    for await (const chunk of adapter.stream({
      provider: 'model-router',
      model: 'deepseek/deepseek-v4-flash',
      messages: [],
    })) chunks.push(chunk)
    expect(delegated).toHaveLength(1)
    expect(delegated[0].provider).toBe('b')
    expect(delegated[0].model).toBe('deepseek/deepseek-v4-flash')
    expect(chunks).toEqual([{ type: 'finish', reason: 'stop' }])
  })

  it('records the merged model id as used for recent ordering', async () => {
    const used: string[] = []
    const f = facts([merged('m1', 'a', 'b')], {
      showQuickSwitch: true,
      ignoreModelIdPrefix: true,
      models: { m1: { order: ['a', 'b'], active: 'a' } },
    })
    const llm = {
      stream: (options: GenerateOptions) => (async function * chunks() {
        yield { type: 'finish', reason: 'stop' } as const
      })(),
    } as unknown as LlmRuntime
    const adapter = new ModelRouterAdapter({ ...f, llm: () => llm, noteModelUsed: id => { used.push(id) } })
    for await (const _chunk of adapter.stream({
      provider: 'model-router',
      model: 'm1',
      messages: [],
    })) { /* drain */ }
    expect(used).toEqual(['m1'])
  })
})
