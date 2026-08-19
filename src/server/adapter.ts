/**
 * The virtual `model-router` LLM adapter. Registered for the single provider
 * route `model-router`, it advertises the merged catalog and, at request time,
 * rewrites the provider field to the model's currently active provider and
 * delegates in-process to `ctx.llm.stream` — credentials, retry, streaming
 * and metering all stay inside the real adapter's pipeline. Incoming model
 * ids are matched with the leading vendor prefix ignored when the settings
 * flag is on, and delegation always uses the active provider's raw local id.
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
  sortModelsForList,
  stripModelIdPrefix,
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
  /** Record one model request for the recent-use ordering (fire-and-forget). */
  noteModelUsed(modelId: string): void
}

/** One resolved route for a model id. */
export interface ResolvedRoute {
  provider: string
}

/**
 * Find the merged model for an incoming model id. Exact lookup first; when
 * prefix-ignore is on, a miss falls back to the prefix-stripped id so a raw
 * `deepseek/deepseek-v4-flash` request matches the merged `deepseek-v4-flash`
 * (advertised ids are already stripped and hit exactly). Unadvertised ids do
 * not match.
 */
export function mergedFor(facts: RouterFacts, modelId: string): MergedModel | null {
  const byId = facts.catalog().byId
  const direct = byId.get(modelId)
  if (direct !== undefined) return direct
  if (!facts.config().ignoreModelIdPrefix) return null
  const stripped = stripModelIdPrefix(modelId)
  if (stripped === modelId) return null
  return byId.get(stripped) ?? null
}

/**
 * Resolve the effective route for one model id: the stored active provider
 * when still present, otherwise the first remaining order entry, otherwise
 * the catalog head. Unadvertised model ids do not route.
 */
export function routeFor(facts: RouterFacts, modelId: string): ResolvedRoute | null {
  const merged = mergedFor(facts, modelId)
  if (merged === null) return null
  const ids = merged.providers.map(provider => provider.provider)
  const active = resolveActive(facts.config(), merged.id, ids)
  return active === null ? null : { provider: active }
}

/** The raw provider-local id of one provider entry inside a merged model. */
export function entryRawId(merged: MergedModel, providerId: string): string {
  return merged.providers.find(provider => provider.provider === providerId)?.id ?? merged.id
}

export class ModelRouterAdapter extends LlmAdapter {
  constructor(private readonly facts: RouterFacts) {
    super()
  }

  providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Model Router' }
  }

  async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    const config = this.facts.config()
    const { models } = this.facts.catalog()
    const names = this.facts.providerNames()
    const out: LlmModelInfo[] = []
    for (const merged of sortModelsForList(models, config)) {
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
    const merged = route === null ? null : mergedFor(this.facts, model)
    if (route === null || merged === null) {
      throw new LlmError(`model-router: no provider serves model "${model}"`, 'NO_ADAPTER')
    }
    // Delegate with the provider's raw local id (it may carry a vendor/
    // prefix the real provider needs), then normalize the resolved identity
    // back to the merged display id so sessions/metering never leak prefixes.
    const resolved = await this.facts.llm().resolveModelInfo(route.provider, entryRawId(merged, route.provider), signal)
    const display = displayProvider(merged, route.provider)
    return {
      ...resolved,
      provider: ROUTER_PROVIDER_ID,
      id: merged.id,
      name: display?.name ?? resolved.name,
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const route = routeFor(this.facts, options.model)
    const merged = route === null ? null : mergedFor(this.facts, options.model)
    if (route === null || merged === null) {
      throw new LlmError(`model-router: no provider serves model "${options.model}"`, 'NO_ADAPTER')
    }
    // Record the use for the recent-use model ordering; never blocks or
    // fails the request (the service debounces persistence).
    try {
      this.facts.noteModelUsed(merged.id)
    } catch {
      // advisory only
    }
    // In-process delegation: the inner call resolves the real adapter and
    // runs its full pipeline (retry, waterfall, replay-state stripping). The
    // model is rewritten to the provider's raw local id — the merged display
    // id may have had its vendor prefix stripped.
    yield* this.facts.llm().stream({
      ...options,
      provider: route.provider,
      model: entryRawId(merged, route.provider),
    })
  }
}
