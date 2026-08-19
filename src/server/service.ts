/**
 * The model-router service: settings persistence, live catalog cache, the
 * virtual adapter registration, topology-triggered reconciliation, and the
 * mutation actions the API surface exposes.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace, type SettingsScope } from '@deepseek-ai/dsh-settings'
import type { AdapterRegistrationHandle } from '@deepseek-ai/dsh-llm'
import {
  initialConfigFor,
  normalizeConfig,
  reconcileConfig,
  ROUTER_PROVIDER_ID,
  ROUTER_SETTINGS_NS,
  resolveActive,
  setActive,
  setOrder,
  sortModelsForList,
  type ModelSortMode,
  type RouterConfigShape,
} from '../shared/config.js'
import { buildCatalog, type RouterCatalog } from './catalog.js'
import { ModelRouterAdapter, type RouterFacts } from './adapter.js'

export const NS = settingsNamespace(ROUTER_SETTINGS_NS)

/** Settings document schema: one entry per model id. */
export const RouterConfigSchema: z<RouterConfigShape> = z.object({
  models: z.dict(z.object({
    order: z.array(z.string()),
    active: z.string(),
  })),
  // Older documents predate the toggles; normalizeConfig defaults both on.
  // Schemastery object keys are input-optional, so absent is valid here.
  showQuickSwitch: z.boolean(),
  ignoreModelIdPrefix: z.boolean(),
  modelSort: z.union([z.const('custom'), z.const('name'), z.const('recent')]),
  modelOrder: z.array(z.string()),
  recentlyUsed: z.dict(z.number()),
})

const EMPTY_CONFIG: RouterConfigShape = {
  models: {},
  showQuickSwitch: true,
  ignoreModelIdPrefix: true,
  modelSort: 'custom',
  modelOrder: [],
  recentlyUsed: {},
}

/** The settings-page state view served by the API. */
export interface ModelRouterState {
  /** Whether the composer quick route-switcher button is enabled. */
  showQuickSwitch: boolean
  /** Whether model ids are matched with their leading vendor/ prefix ignored. */
  ignoreModelIdPrefix: boolean
  /** The model-list display order mode (custom | name | recent). */
  modelSort: ModelSortMode
  /** Explicit model id order for custom mode (display order). */
  modelOrder: string[]
  providers: Array<{ id: string; name: string; credentialConfigured: boolean }>
  models: Array<{
    id: string
    /** Display name following the effective active provider. */
    name: string
    /** Effective active provider (never null while the model has providers). */
    active: string | null
    /** Effective provider preference order. */
    order: string[]
    providers: Array<{ id: string; name: string; credentialConfigured: boolean }>
  }>
}

export class ModelRouterService implements RouterFacts {
  private readonly ctx: Context
  private cached: RouterCatalog = {
    providers: [],
    providerNames: new Map(),
    models: [],
    byId: new Map(),
    credentialConfigured: new Map(),
  }
  private inflight: Promise<RouterCatalog> | null = null
  private cachedAt = 0
  private scope: SettingsScope<RouterConfigShape> | undefined
  private registration: AdapterRegistrationHandle | undefined

  /** How long a built catalog is considered fresh before being rebuilt. */
  private readonly catalogTtlMs = 30_000

  /** Debounced recent-use persistence (see noteModelUsed / flushUsage). */
  private readonly usageFlushMs = 1_500
  private usageDebounce: ReturnType<typeof setTimeout> | null = null
  private pendingUsage: Record<string, number> = {}
  private usageFlushRunning = false

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  /** Register settings + adapter and wire topology listeners. */
  start(): void {
    // Optional settings service: without one the router still routes
    // (config falls back to catalog order) but cannot persist.
    this.ctx.inject(['settings'], (sctx) => {
      this.scope = sctx.settings.register(NS, RouterConfigSchema) as SettingsScope<RouterConfigShape>
    })

    const adapter = new ModelRouterAdapter(this)
    this.registration = this.ctx.llm.registerAdapter([ROUTER_PROVIDER_ID], adapter)

    // Provider topology changes (added/removed providers, catalog swaps)
    // invalidate the cache and reconcile the stored document.
    this.ctx.on('llm/adapters-updated', () => {
      void this.refreshAndReconcile()
    })

    // First load + reconcile: never block plugin startup on the catalog.
    void this.refreshAndReconcile()
  }

  stop(): void {
    // Flush any pending recent-use writes before the scope is torn down.
    if (this.usageDebounce !== null) {
      clearTimeout(this.usageDebounce)
      this.usageDebounce = null
    }
    if (Object.keys(this.pendingUsage).length > 0) {
      void this.flushUsage()
    }
    this.registration?.()
    this.registration = undefined
  }

  // ── RouterFacts ──────────────────────────────────────────────────────────

  catalog(): { models: RouterCatalog['models']; byId: RouterCatalog['byId'] } {
    return { models: this.cached.models, byId: this.cached.byId }
  }

  config(): RouterConfigShape {
    if (this.scope === undefined) return EMPTY_CONFIG
    try {
      return normalizeConfig(this.scope.get())
    } catch {
      return EMPTY_CONFIG
    }
  }

  providerNames(): ReadonlyMap<string, string> {
    return this.cached.providerNames
  }

  llm() {
    return this.ctx.llm
  }

  /**
   * Record one model request for the `recent` display order. Fire-and-forget
   * (the adapter never awaits it): timestamps accumulate in memory and are
   * persisted debounced, so a burst of requests coalesces into one settings
   * write.
   */
  noteModelUsed(modelId: string): void {
    if (this.scope === undefined) return
    this.pendingUsage[modelId] = Date.now()
    if (this.usageDebounce !== null) return
    this.usageDebounce = setTimeout(() => {
      this.usageDebounce = null
      void this.flushUsage()
    }, this.usageFlushMs)
  }

  /** Persist accumulated usage timestamps (merging with any concurrent writes). */
  private async flushUsage(): Promise<void> {
    if (this.usageFlushRunning) return
    this.usageFlushRunning = true
    const pending = this.pendingUsage
    this.pendingUsage = {}
    try {
      if (this.scope === undefined || Object.keys(pending).length === 0) return
      const current = this.config()
      await this.scope.replace({
        ...current,
        recentlyUsed: { ...current.recentlyUsed, ...pending },
      })
    } catch (error) {
      // Re-queue the failed batch so a transient write failure does not lose
      // usage history; the next request retries it.
      this.pendingUsage = { ...pending, ...this.pendingUsage }
      this.ctx.logger.warn(`model-router: usage persist failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.usageFlushRunning = false
    }
  }

  // ── catalog lifecycle ────────────────────────────────────────────────────

  /**
   * Return the live catalog, rebuilding it only when it is stale (older than
   * `catalogTtlMs`) or `force` is set. Concurrent callers share one in-flight
   * build; a failed build keeps the last good catalog.
   *
   * The TTL is what keeps the composer quick-switcher snappy: every
   * `state()` RPC goes through here, and without a cache each one rebuilt the
   * catalog — including per-provider `listModels` network calls — which is
   * what made the button gray out (routerLoading) for the whole duration.
   * Topology events (`llm/adapters-updated`) and explicit user refreshes pass
   * `force` so the cache never hides real changes.
   */
  refreshCatalog(force = false): Promise<RouterCatalog> {
    if (!force && this.inflight === null && Date.now() - this.cachedAt < this.catalogTtlMs) {
      return Promise.resolve(this.cached)
    }
    if (this.inflight !== null) return this.inflight
    this.inflight = buildCatalog(this.ctx, this.config().ignoreModelIdPrefix)
      .then((catalog) => {
        this.cached = catalog
        this.cachedAt = Date.now()
        return catalog
      })
      .catch((error) => {
        this.ctx.logger.warn(`model-router: catalog refresh failed: ${error instanceof Error ? error.message : String(error)}`)
        return this.cached
      })
      .finally(() => {
        this.inflight = null
      })
    return this.inflight
  }

  /** Refresh (forced), then persist any config drift (migration, new/vanished models). */
  async refreshAndReconcile(): Promise<void> {
    const catalog = await this.refreshCatalog(true)
    if (this.scope === undefined) return
    const current = this.config()
    const { models, modelOrder, changed } = reconcileConfig(current, catalog.models)
    if (!changed) return
    try {
      await this.scope.replace({
        ...current,
        models,
        ...(modelOrder === undefined ? {} : { modelOrder }),
      })
    } catch (error) {
      this.ctx.logger.warn(`model-router: reconcile persist failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ── actions ──────────────────────────────────────────────────────────────

  /** Effective active provider for one model id (null when unroutable). */
  activeFor(modelId: string): string | null {
    const ids = this.cached.byId.get(modelId)?.providers.map(provider => provider.provider) ?? []
    return resolveActive(this.config(), modelId, ids)
  }

  /** The complete state view for the settings page. */
  async state(): Promise<ModelRouterState> {
    await this.refreshCatalog()
    const catalog = this.cached
    const config = this.config()
    const names = catalog.providerNames
    const creds = catalog.credentialConfigured
    return {
      showQuickSwitch: config.showQuickSwitch,
      ignoreModelIdPrefix: config.ignoreModelIdPrefix,
      modelSort: config.modelSort,
      modelOrder: config.modelOrder,
      providers: catalog.providers.map(provider => ({
        id: provider.id,
        name: names.get(provider.id) ?? provider.id,
        credentialConfigured: creds.get(provider.id) ?? true,
      })),
      models: sortModelsForList(catalog.models, config).map((model) => {
        const ids = model.providers.map(provider => provider.provider)
        const stored = config.models[model.id] ?? initialConfigFor(ids)
        const active = resolveActive(config, model.id, ids)
        const activeEntry = model.providers.find(provider => provider.provider === active) ?? model.providers[0]
        return {
          id: model.id,
          name: activeEntry?.name ?? model.id,
          active,
          order: stored?.order ?? [...ids],
          providers: model.providers.map(provider => ({
            id: provider.provider,
            name: names.get(provider.provider) ?? provider.provider,
            credentialConfigured: creds.get(provider.provider) ?? true,
          })),
        }
      }),
    }
  }

  /** Switch the active provider for one model (persisted, live on next request). */
  async switchActive(modelId: string, providerId: string): Promise<void> {
    await this.refreshCatalog()
    const ids = this.cached.byId.get(modelId)?.providers.map(provider => provider.provider)
    if (ids === undefined || ids.length === 0) {
      throw new Error(`model-router: model "${modelId}" is not served by any provider`)
    }
    const { models, changed } = setActive(this.config(), modelId, providerId, ids)
    if (!changed) return
    await this.persist(models)
  }

  /** Replace the preference order for one model (active left untouched). */
  async reorder(modelId: string, order: string[]): Promise<void> {
    await this.refreshCatalog()
    const ids = this.cached.byId.get(modelId)?.providers.map(provider => provider.provider)
    if (ids === undefined || ids.length === 0) {
      throw new Error(`model-router: model "${modelId}" is not served by any provider`)
    }
    const { models, changed } = setOrder(this.config(), modelId, order, ids)
    if (!changed) return
    await this.persist(models)
  }

  /** Toggle the composer quick route-switcher button (global, persisted). */
  async setShowQuickSwitch(value: boolean): Promise<void> {
    if (this.scope === undefined) {
      throw new Error('model-router: settings service is not available in this profile')
    }
    const current = this.config()
    if (current.showQuickSwitch === value) return
    await this.scope.replace({ ...current, showQuickSwitch: value })
  }

  /**
   * Toggle prefix-ignored model matching (global, persisted). Persists the
   * flag first, then rebuilds the catalog with the new merge rule and
   * reconciles stored config (migrates prefixed keys to merged ids when
   * turning on; split models re-initialize when turning off).
   */
  async setIgnoreModelIdPrefix(value: boolean): Promise<void> {
    if (this.scope === undefined) {
      throw new Error('model-router: settings service is not available in this profile')
    }
    const current = this.config()
    if (current.ignoreModelIdPrefix === value) return
    await this.scope.replace({ ...current, ignoreModelIdPrefix: value })
    await this.refreshAndReconcile()
  }

  /** Switch the model-list display order mode (global, persisted). */
  async setModelSort(mode: ModelSortMode): Promise<void> {
    if (this.scope === undefined) {
      throw new Error('model-router: settings service is not available in this profile')
    }
    const current = this.config()
    if (current.modelSort === mode) return
    await this.scope.replace({ ...current, modelSort: mode })
  }

  /**
   * Replace the explicit custom model order (global, persisted). Vanished
   * ids are pruned and missing catalog models appended, so the stored order
   * always covers the live catalog.
   */
  async setModelOrder(order: string[]): Promise<void> {
    if (this.scope === undefined) {
      throw new Error('model-router: settings service is not available in this profile')
    }
    await this.refreshCatalog()
    const ids = new Set(this.cached.models.map(model => model.id))
    const clean = order.filter(id => ids.has(id))
    for (const model of this.cached.models) {
      if (!clean.includes(model.id)) clean.push(model.id)
    }
    const current = this.config()
    const sameOrder = clean.length === current.modelOrder.length
      && clean.every((id, at) => id === current.modelOrder[at])
    if (sameOrder) return
    await this.scope.replace({ ...current, modelOrder: clean })
  }

  private async persist(models: Record<string, { order: string[]; active: string }>): Promise<void> {
    if (this.scope === undefined) {
      throw new Error('model-router: settings service is not available in this profile')
    }
    const current = this.config()
    await this.scope.replace({ ...current, models })
  }
}
