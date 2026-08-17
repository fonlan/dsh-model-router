/**
 * @fonlan/dsh-model-router shared routing core — pure functions, no side
 * effects, unit-tested in test/config.test.ts and shared verbatim between the
 * server half (route resolution at request time) and the client bundle
 * (settings page rendering).
 *
 * Decided semantics (grilling session, all recommendations accepted):
 * - Merge: models are merged across providers by model id — by exact id, or
 *   (when ignoreModelIdPrefix is on) by id with the first `vendor/` segment
 *   stripped, so `deepseek/deepseek-v4-flash` and `deepseek-v4-flash` are the
 *   same model. Display always uses the merged (prefix-free) id; each provider
 *   entry keeps its own raw local id for delegation.
 * - Per-model provider config: an order[] (future auto-failover preference)
 *   plus an independent active provider (what requests actually route to).
 * - First-seen provider order: for a never-configured model the initial
 *   order is provider discovery order and the initial active is its head.
 * - Vanished providers: pruned from order; when active vanishes, fall back to
 *   the first remaining provider automatically.
 * - New providers for a known model: appended at the end of order; active
 *   untouched.
 * - Prefix-ignore migration: stored config keyed by a now-stripped raw id
 *   moves to the merged id (unprefixed entry wins when both exist; order is a
 *   deduped union). Turning the flag off does not migrate back — the split
 *   models re-initialize from discovery order.
 */

/** One provider's view of one model. */
export interface ProviderModelInfo {
  /** Provider id the model belongs to. */
  provider: string
  /** Provider-local raw model id, exactly as the provider advertises it
   *  (may carry a `vendor/` prefix; this is the id delegation must use). */
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

/** One merged model across all providers. */
export interface MergedModel {
  /** Merged display id — the raw id with the leading segment stripped when
   *  prefix-ignore is on, so it is always shown without a vendor prefix. */
  id: string
  /** Per-provider entries in provider discovery order (raw local ids). */
  providers: ProviderModelInfo[]
}

/** Router configuration for one model (keyed by merged id). */
export interface RouterModelConfig {
  /** Provider ids in preference order (future auto-failover). */
  order: string[]
  /** The provider requests currently route to. */
  active: string
}

/** The whole router config document. */
export interface RouterConfigShape {
  models: Record<string, RouterModelConfig>
  /**
   * Whether the quick route-switcher button is shown beside the composer
   * model selector (settings → 模型路由 → 显示快速路由切换按钮). Stored
   * globally; absent/unknown documents normalize to `true`.
   */
  showQuickSwitch: boolean
  /**
   * Whether model ids are matched with their leading `vendor/` segment
   * ignored (settings → 模型路由 → 匹配时忽略模型 ID 前缀), so
   * `deepseek/deepseek-v4-flash` and `deepseek-v4-flash` merge into one model
   * displayed as `deepseek-v4-flash`. Absent/unknown documents normalize to
   * `true`.
   */
  ignoreModelIdPrefix: boolean
}

export const ROUTER_PROVIDER_ID = 'model-router'
export const ROUTER_SETTINGS_NS = 'model-router'

/**
 * Strip the first path segment (`vendor/`) from a model id, case-sensitively.
 * Inert for ids without a prefix: no slash, an empty first segment, or an
 * empty remainder all return the input unchanged. `a/b/c` becomes `b/c`.
 */
export function stripModelIdPrefix(id: string): string {
  const slash = id.indexOf('/')
  if (slash <= 0 || slash === id.length - 1) return id
  return id.slice(slash + 1)
}

export interface MergeOptions {
  /** Group by prefix-stripped id instead of the exact raw id. */
  ignorePrefix?: boolean
}

/**
 * Merge every provider's models into one entry per model id. With
 * `ignorePrefix` the group key is the prefix-stripped id and the merged id is
 * that stripped id, while each provider entry keeps its raw local id. When a
 * single provider advertises both a prefixed and the unprefixed raw id for the
 * same group (a same-provider collision), the unprefixed raw id wins (it is
 * the canonical form); otherwise the first-seen raw id wins.
 */
export function mergeModels(providers: readonly ProviderInfo[], options: MergeOptions = {}): MergedModel[] {
  const byId = new Map<string, MergedModel>()
  for (const provider of providers) {
    // Choose one raw id per group key for this provider, preferring the
    // unprefixed one when both exist.
    const chosen = new Map<string, string>()
    for (const model of provider.models) {
      const key = options.ignorePrefix ? stripModelIdPrefix(model.id) : model.id
      const prev = chosen.get(key)
      if (prev === undefined || (prev !== key && model.id === key)) {
        chosen.set(key, model.id)
      }
    }
    for (const model of provider.models) {
      const key = options.ignorePrefix ? stripModelIdPrefix(model.id) : model.id
      if (chosen.get(key) !== model.id) continue
      let merged = byId.get(key)
      if (merged === undefined) {
        merged = { id: key, providers: [] }
        byId.set(key, merged)
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

function sameModels(a: Record<string, RouterModelConfig>, b: Record<string, RouterModelConfig>): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    const x = a[key]
    const y = b[key]
    if (y === undefined || x.active !== y.active || x.order.length !== y.order.length) return false
    if (!x.order.every((id, i) => id === y.order[i])) return false
  }
  return true
}

/**
 * Reconcile the stored config document against the live merged catalog.
 *
 * Beyond the per-model sync of {@link syncConfig}, this remaps stored entries
 * to their merged ids: with prefix-ignore on, an entry keyed by a raw id that
 * now strips to a merged id (e.g. `deepseek/deepseek-v4-flash` →
 * `deepseek-v4-flash`) migrates to that merged id. When several stored keys
 * collapse onto one merged id, the entry keyed by the merged id itself wins
 * for `active`, and `order` becomes the deduped union in exact-key-first
 * order. Stored keys no longer mapping to any merged model are dropped (this
 * also covers turning the flag off — split models re-initialize fresh).
 */
export function reconcileConfig(
  config: RouterConfigShape,
  models: readonly MergedModel[],
): { models: Record<string, RouterModelConfig>; changed: boolean } {
  // stored key → merged id it belongs to (exact key wins; prefixed raw keys
  // map to their stripped merged id only while the flag is on)
  const keyToMerged = new Map<string, string>()
  for (const model of models) {
    keyToMerged.set(model.id, model.id)
    if (!config.ignoreModelIdPrefix) continue
    for (const provider of model.providers) {
      if (stripModelIdPrefix(provider.id) === model.id && !keyToMerged.has(provider.id)) {
        keyToMerged.set(provider.id, model.id)
      }
    }
  }

  const grouped = new Map<string, Array<{ key: string; entry: RouterModelConfig }>>()
  for (const [key, entry] of Object.entries(config.models)) {
    const mergedId = keyToMerged.get(key)
    if (mergedId === undefined) continue // stale: dropped from the next doc
    const list = grouped.get(mergedId) ?? []
    list.push({ key, entry })
    grouped.set(mergedId, list)
  }

  const next: Record<string, RouterModelConfig> = {}
  for (const model of models) {
    const ids = model.providers.map(provider => provider.provider)
    const list = grouped.get(model.id)
    let base: RouterModelConfig | undefined
    if (list !== undefined && list.length > 0) {
      const exact = list.find(group => group.key === model.id)
      const ordered = exact === undefined ? list : [exact, ...list.filter(group => group.key !== model.id)]
      const order: string[] = []
      for (const group of ordered) {
        for (const id of group.entry.order) {
          if (!order.includes(id)) order.push(id)
        }
      }
      base = { order, active: exact?.entry.active ?? ordered[0].entry.active }
    }
    const view: RouterConfigShape = { ...config, models: { ...next } }
    if (base !== undefined) view.models[model.id] = base
    const result = syncConfig(view, model.id, ids)
    const entry = result.models[model.id]
    if (entry !== undefined) next[model.id] = entry
  }

  return { models: next, changed: !sameModels(next, config.models) }
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
  if (typeof value !== 'object' || value === null) {
    return { models, showQuickSwitch: true, ignoreModelIdPrefix: true }
  }
  const root = value as { models?: unknown; showQuickSwitch?: unknown; ignoreModelIdPrefix?: unknown }
  const showQuickSwitch = root.showQuickSwitch !== false
  const ignoreModelIdPrefix = root.ignoreModelIdPrefix !== false
  const raw = root.models
  if (typeof raw !== 'object' || raw === null) return { models, showQuickSwitch, ignoreModelIdPrefix }
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as { order?: unknown; active?: unknown }
    const order = Array.isArray(e.order) ? e.order.filter((x): x is string => typeof x === 'string') : []
    const active = typeof e.active === 'string' ? e.active : order[0] ?? ''
    if (active === '') continue
    models[id] = { order, active }
  }
  return { models, showQuickSwitch, ignoreModelIdPrefix }
}
