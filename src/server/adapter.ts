/**
 * The virtual `model-router` LLM adapter. Registered for the single provider
 * route `model-router`, it advertises the merged catalog and, at request time,
 * rewrites the provider field to the model's currently active provider and
 * delegates in-process to `ctx.llm.stream` — credentials, retry, streaming
 * and metering all stay inside the real adapter's pipeline.
 */
import { LlmAdapter, LlmError, type LlmRuntime } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  displayProvider,
  resolveActive,
  ROUTER_PROVIDER_ID,
  type MergedModel,
  type RouterConfigShape,
} from '../shared/config.js'

/** Facts the adapter reads from the owning service (live, per request). */
export interface RouterFacts {
  /** Current merged catalog (refreshed on topology changes). */
  catalog(): { models: readonly MergedModel[]; byId: ReadonlyMap<string, MergedModel> }
  /** Current stored router config. */
  config(): RouterConfigShape
  /** Provider display names by id. */
  providerNames(): ReadonlyMap<string, string>
  /** The LLM runtime to delegate to. */
  llm(): LlmRuntime
}

/** One resolved route for a model id. */
export interface ResolvedRoute {
  provider: string
}

/**
 * Resolve the effective route for one model id: the stored active provider
 * when still present, otherwise the first remaining order entry, otherwise
 * the catalog head. Unadvertised model ids do not route.
 */
export function routeFor(facts: RouterFacts, modelId: string): ResolvedRoute | null {
  const merged = facts.catalog().byId.get(modelId)
  if (merged === undefined) return null
  const ids = merged.providers.map(provider => provider.provider)
  const active = resolveActive(facts.config(), modelId, ids)
  return active === null ? null : { provider: active }
}

export class ModelRouterAdapter extends LlmAdapter {
  constructor(private readonly facts: RouterFacts) {
    super()
  }

  providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Model Router' }
  }

  async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    const { models } = this.facts.catalog()
    const names = this.facts.providerNames()
    const out: LlmModelInfo[] = []
    for (const merged of models) {
      const route = routeFor(this.facts, merged.id)
      const display = displayProvider(merged, route?.provider)
      if (display === null) continue
      out.push({
        provider: ROUTER_PROVIDER_ID,
        id: merged.id,
        name: display.name,
        description: `via ${names.get(display.provider) ?? display.provider}`,
      })
    }
    return out
  }

  async resolveModel(_provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const route = routeFor(this.facts, model)
    if (route === null) {
      throw new LlmError(`model-router: no provider serves model "${model}"`, 'NO_ADAPTER')
    }
    const resolved = await this.facts.llm().resolveModelInfo(route.provider, model, signal)
    return { ...resolved, provider: ROUTER_PROVIDER_ID }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const route = routeFor(this.facts, options.model)
    if (route === null) {
      throw new LlmError(`model-router: no provider serves model "${options.model}"`, 'NO_ADAPTER')
    }
    // In-process delegation: the inner call resolves the real adapter and
    // runs its full pipeline (retry, waterfall, replay-state stripping).
    yield* this.facts.llm().stream({ ...options, provider: route.provider })
  }
}
