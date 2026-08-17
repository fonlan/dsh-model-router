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
  ROUTER_PROVIDER_ID,
  ROUTER_SETTINGS_NS,
  resolveActive,
  setActive,
  setOrder,
  syncConfig,
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
  // Older documents predate the toggle; normalizeConfig defaults to true.
  // Schemastery object keys are input-optional, so absent is valid here.
  showQuickSwitch: z.boolean(),
})

const EMPTY_CONFIG: RouterConfigShape = { models: {}, showQuickSwitch: true }

/** The settings-page state view served by the API. */
export interface ModelRouterState {
  /** Whether the composer quick route-switcher button is enabled. */
  showQuickSwitch: boolean
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
  private scope: SettingsScope<RouterConfigShape> | undefined
  private registration: AdapterRegistrationHandle | undefined

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

  // ── catalog lifecycle ────────────────────────────────────────────────────

  /** Rebuild the catalog (in-flight dedupe; failures keep the last good one). */
  refreshCatalog(): Promise<RouterCatalog> {
    if (this.inflight !== null) return this.inflight
    this.inflight = buildCatalog(this.ctx)
      .then((catalog) => {
        this.cached = catalog
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

  /** Refresh, then persist any config drift (new providers/models, vanish). */
  async refreshAndReconcile(): Promise<void> {
    const catalog = await this.refreshCatalog()
    if (this.scope === undefined) return
    const current = this.config()
    const next = { ...current.models }
    let changed = false
    for (const model of catalog.models) {
      const ids = model.providers.map(provider => provider.provider)
      const result = syncConfig(current, model.id, ids)
      if (result.changed) changed = true
      for (const [id, entry] of Object.entries(result.models)) {
        if (entry === undefined) delete next[id]
        else next[id] = entry
      }
    }
    // Drop stored entries whose model no longer exists anywhere.
    for (const id of Object.keys(next)) {
      if (!catalog.byId.has(id)) {
        delete next[id]
        changed = true
      }
    }
    if (!changed) return
    try {
      await this.scope.replace({ models: next, showQuickSwitch: this.config().showQuickSwitch })
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
      providers: catalog.providers.map(provider => ({
        id: provider.id,
        name: names.get(provider.id) ?? provider.id,
        credentialConfigured: creds.get(provider.id) ?? true,
      })),
      models: catalog.models.map((model) => {
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
    await this.scope.replace({ models: current.models, showQuickSwitch: value })
  }

  private async persist(models: Record<string, { order: string[]; active: string }>): Promise<void> {
    if (this.scope === undefined) {
      throw new Error('model-router: settings service is not available in this profile')
    }
    await this.scope.replace({ models, showQuickSwitch: this.config().showQuickSwitch })
  }
}
