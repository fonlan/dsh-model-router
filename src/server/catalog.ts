/**
 * Provider discovery for the router: every registered LLM provider route
 * (minus the router itself) becomes a ProviderInfo, models merge through the
 * shared core (by exact id, or by prefix-stripped id when `ignorePrefix` is
 * on), and per-provider credential status is detected generically through the
 * configurable-provider directory + the credentials seam.
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { mergeModels, ROUTER_PROVIDER_ID, type MergedModel, type ProviderInfo } from '../shared/config.js'

/** Live router catalog: everything the router can advertise and route to. */
export interface RouterCatalog {
  /** All providers (minus the router) in registration order. */
  providers: ProviderInfo[]
  /** Provider id → human display name (configurable-directory name when known). */
  providerNames: Map<string, string>
  /** Models merged across providers (exact id, or stripped when flag on). */
  models: MergedModel[]
  /** Model id → merged model. */
  byId: Map<string, MergedModel>
  /** Provider id → whether the provider currently has usable credentials. */
  credentialConfigured: Map<string, boolean>
}

const EMPTY_CATALOG: RouterCatalog = {
  providers: [],
  providerNames: new Map(),
  models: [],
  byId: new Map(),
  credentialConfigured: new Map(),
}

interface ConfigurableEntry {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: readonly string[]
}

/** Read the resolved value of another plugin's settings section, if registered. */
function settingsSection(ctx: Context, ns: string): unknown {
  try {
    return (ctx.settings as SettingsProvider).get(ns as never)
  } catch {
    return undefined
  }
}

/**
 * Determine whether one provider has usable credentials. Generic: the
 * configurable-provider directory names the settings section + path where the
 * provider's profile (and its optional apiKeyEnv) lives; the credentials seam
 * answers whether that reference currently resolves. Providers without a
 * directory entry or without an apiKeyEnv answer "configured" (unknown —
 * never gray out what we cannot verify).
 */
async function detectCredentialConfigured(
  ctx: Context,
  entry: ConfigurableEntry | undefined,
): Promise<boolean> {
  if (entry === undefined) return true
  const section = settingsSection(ctx, entry.settingsNs)
  let profile: unknown = section
  for (const key of entry.settingsPath) {
    if (typeof profile !== 'object' || profile === null) {
      profile = undefined
      break
    }
    profile = (profile as Record<string, unknown>)[key]
  }
  const apiKeyEnv = typeof profile === 'object' && profile !== null
    ? (profile as Record<string, unknown>).apiKeyEnv
    : undefined
  if (typeof apiKeyEnv !== 'string' || apiKeyEnv.trim() === '') return true
  let credentials: CredentialProvider | undefined
  try {
    credentials = ctx.get('credentials') as CredentialProvider | undefined
  } catch {
    credentials = undefined
  }
  if (credentials === undefined) return true
  try {
    return (await credentials.describe(credentialRef(apiKeyEnv.trim()))).configured
  } catch {
    return true
  }
}

/** Rebuild the live router catalog from the LLM registry. */
export async function buildCatalog(ctx: Context, ignorePrefix = false): Promise<RouterCatalog> {
  const routes = ctx.llm.listProviders().filter(provider => provider.id !== ROUTER_PROVIDER_ID)
  const directory = new Map<string, ConfigurableEntry>(
    ctx.llm.listConfigurableProviders().map(entry => [entry.provider, {
      provider: entry.provider,
      displayName: entry.displayName,
      settingsNs: entry.settingsNs,
      settingsPath: entry.settingsPath,
    }]),
  )

  const providers: ProviderInfo[] = []
  const providerNames = new Map<string, string>()
  const credentialConfigured = new Map<string, boolean>()

  for (const route of routes) {
    const entry = directory.get(route.id)
    providerNames.set(route.id, entry?.displayName || route.name || route.id)
    const seen = new Set<string>()
    const models: Array<{ id: string; name: string; contextWindow?: number; maxTokens?: number }> = []
    try {
      for (const model of await ctx.llm.listModels(route.id)) {
        if (seen.has(model.id)) continue
        seen.add(model.id)
        models.push({ id: model.id, name: model.name })
      }
    } catch {
      // provider whose catalog is unavailable contributes no models
    }
    providers.push({ id: route.id, name: route.name, models })
    credentialConfigured.set(route.id, await detectCredentialConfigured(ctx, entry))
  }

  const models = mergeModels(providers, { ignorePrefix })
  const byId = new Map(models.map(model => [model.id, model]))
  return { providers, providerNames, models, byId, credentialConfigured }
}
