/**
 * @fonlan/dsh-model-router shared routing core — pure functions, no side
 * effects, unit-tested in test/config.test.ts and shared verbatim between the
 * server half (route resolution at request time) and the client bundle
 * (settings page rendering).
 *
 * Decided semantics (grilling session, all recommendations accepted):
 * - Strict merge: models are merged across providers by exact model id only.
 * - Per-model provider config: an order[] (future auto-failover preference)
 *   plus an independent active provider (what requests actually route to).
 * - First-seen provider order: for a never-configured model the initial
 *   order is provider discovery order and the initial active is its head.
 * - Vanished providers: pruned from order; when active vanishes, fall back to
 *   the first remaining provider automatically.
 * - New providers for a known model: appended at the end of order; active
 *   untouched.
 */

/** One provider's view of one model. */
export interface ProviderModelInfo {
  /** Provider id the model belongs to. */
  provider: string
  /** Provider-local model id (== merged model id, strict merge). */
  id: string
  /** Provider-local display name. */
  name: string
  /** Provider-local context window (tokens), when advertised. */
  contextWindow?: number
  /** Provider-local max output tokens, when advertised. */
  maxTokens?: number
}

/** One configured provider as discovered from the host. */
export interface ProviderInfo {
  id: string
  /** Provider display name when advertised. */
  name?: string
  models: Array<Omit<ProviderModelInfo, 'provider'>>
}

/** One merged model across all providers (strict id merge). */
export interface MergedModel {
  id: string
  /** Per-provider entries in provider discovery order. */
  providers: ProviderModelInfo[]
}

/** Router configuration for one model. */
export interface RouterModelConfig {
  /** Provider ids in preference order (future auto-failover). */
  order: string[]
  /** The provider requests currently route to. */
  active: string
}

/** The whole router config document. */
export interface RouterConfigShape {
  models: Record<string, RouterModelConfig>
}

export const ROUTER_PROVIDER_ID = 'model-router'
export const ROUTER_SETTINGS_NS = 'model-router'

/** Merge every provider's models into one entry per exact model id. */
export function mergeModels(providers: readonly ProviderInfo[]): MergedModel[] {
  const byId = new Map<string, MergedModel>()
  for (const provider of providers) {
    for (const model of provider.models) {
      let merged = byId.get(model.id)
      if (merged === undefined) {
        merged = { id: model.id, providers: [] }
        byId.set(model.id, merged)
      }
      merged.providers.push({
        provider: provider.id,
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      })
    }
  }
  return [...byId.values()]
}

/** The provider view a merged model should display for (follows active). */
export function displayProvider(
  merged: MergedModel,
  active: string | undefined,
): ProviderModelInfo | null {
  if (merged.providers.length === 0) return null
  return merged.providers.find(p => p.provider === active) ?? merged.providers[0]
}

/** Initial config for a model the user never configured: first in order wins. */
export function initialConfigFor(providerIds: readonly string[]): RouterModelConfig | null {
  if (providerIds.length === 0) return null
  return { order: [...providerIds], active: providerIds[0] }
}

/**
 * Effective active provider for a model id.
 *
 * Rules: a stored active still present in the catalog wins; otherwise the
 * first stored order entry still present wins; otherwise the first provider
 * of the catalog wins; an empty catalog yields null.
 */
export function resolveActive(
  config: RouterConfigShape,
  modelId: string,
  catalogProviderIds: readonly string[],
): string | null {
  if (catalogProviderIds.length === 0) return null
  const stored = config.models[modelId]
  if (stored !== undefined) {
    if (catalogProviderIds.includes(stored.active)) return stored.active
    const firstRemaining = stored.order.find(id => catalogProviderIds.includes(id))
    if (firstRemaining !== undefined) return firstRemaining
  }
  return catalogProviderIds[0]
}

/**
 * Reconcile one model's config against the live catalog: prune vanished
 * providers, append newly discovered ones, and repair a vanished active by
 * falling back to the first remaining provider. Returns the new config, or
 * undefined when the catalog leaves nothing to route to.
 */
export function syncConfig(
  config: RouterConfigShape,
  modelId: string,
  catalogProviderIds: readonly string[],
): { models: Record<string, RouterModelConfig>; changed: boolean } {
  const next = { ...config.models }
  let changed = false

  const existing = next[modelId]
  if (catalogProviderIds.length === 0) {
    if (existing !== undefined) {
      delete next[modelId]
      changed = true
    }
    return { models: next, changed }
  }

  if (existing === undefined) {
    const initial = initialConfigFor(catalogProviderIds)
    if (initial !== null) {
      next[modelId] = initial
      changed = true
    }
    return { models: next, changed }
  }

  const catalog = new Set(catalogProviderIds)
  const order = existing.order.filter(id => catalog.has(id))
  if (order.length !== existing.order.length) changed = true
  for (const id of catalogProviderIds) {
    if (!order.includes(id)) {
      order.push(id)
      changed = true
    }
  }
  let active = existing.active
  if (!catalog.has(active)) {
    active = order[0]
    changed = true
  }
  if (changed) {
    next[modelId] = { order, active }
  }
  return { models: next, changed }
}

/** Switch a model's active provider (no-op when already active). */
export function setActive(
  config: RouterConfigShape,
  modelId: string,
  providerId: string,
  catalogProviderIds: readonly string[],
): { models: Record<string, RouterModelConfig>; changed: boolean } {
  if (!catalogProviderIds.includes(providerId)) {
    throw new Error(`provider ${providerId} is not in the catalog for model ${modelId}`)
  }
  const synced = syncConfig(config, modelId, catalogProviderIds)
  const next = synced.models
  const entry = next[modelId]
  if (entry === undefined) return { models: next, changed: synced.changed }
  if (entry.active === providerId) return { models: next, changed: synced.changed }
  next[modelId] = { ...entry, active: providerId }
  return { models: next, changed: true }
}

/** Replace a model's provider preference order (active left untouched). */
export function setOrder(
  config: RouterConfigShape,
  modelId: string,
  order: readonly string[],
  catalogProviderIds: readonly string[],
): { models: Record<string, RouterModelConfig>; changed: boolean } {
  const catalog = new Set(catalogProviderIds)
  const clean = order.filter(id => catalog.has(id))
  for (const id of catalogProviderIds) {
    if (!clean.includes(id)) clean.push(id)
  }
  const synced = syncConfig(config, modelId, catalogProviderIds)
  const next = synced.models
  const entry = next[modelId]
  if (entry === undefined) return { models: next, changed: synced.changed }
  const sameOrder = entry.order.length === clean.length && entry.order.every((id, i) => id === clean[i])
  if (sameOrder) return { models: next, changed: synced.changed }
  next[modelId] = { ...entry, order: [...clean] }
  return { models: next, changed: true }
}

/** Shape-validate an unknown value as a RouterConfigShape (lenient). */
export function normalizeConfig(value: unknown): RouterConfigShape {
  const models: Record<string, RouterModelConfig> = {}
  if (typeof value !== 'object' || value === null) return { models }
  const raw = (value as { models?: unknown }).models
  if (typeof raw !== 'object' || raw === null) return { models }
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as { order?: unknown; active?: unknown }
    const order = Array.isArray(e.order) ? e.order.filter((x): x is string => typeof x === 'string') : []
    const active = typeof e.active === 'string' ? e.active : order[0] ?? ''
    if (active === '') continue
    models[id] = { order, active }
  }
  return { models }
}
