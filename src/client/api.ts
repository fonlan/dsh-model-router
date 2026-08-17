/** Client transport for the model-router settings API. */
export interface RouterProviderView {
  id: string
  name: string
  credentialConfigured: boolean
}

export interface RouterModelView {
  id: string
  name: string
  active: string | null
  order: string[]
  providers: RouterProviderView[]
}

export interface ModelRouterState {
  /** Whether the composer quick route-switcher button is enabled. */
  showQuickSwitch: boolean
  /** Whether model ids are matched with their leading vendor/ prefix ignored. */
  ignoreModelIdPrefix: boolean
  providers: RouterProviderView[]
  models: RouterModelView[]
}

export class ModelRouterApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

async function call<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/plugins/@fonlan/dsh-model-router/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    throw new ModelRouterApiError('network', error instanceof Error ? error.message : String(error))
  }
  const parsed: { ok?: boolean; value?: unknown; error?: { code?: string; message?: string } } | null
    = await response.json().catch(() => null)
  if (!response.ok || parsed === null || parsed.ok !== true || parsed.value === undefined) {
    throw new ModelRouterApiError(
      parsed?.error?.code ?? 'http',
      parsed?.error?.message ?? `HTTP ${response.status}`,
    )
  }
  return parsed.value as T
}

export const api = {
  state: () => call<ModelRouterState>('state'),
  switchActive: (modelId: string, providerId: string) =>
    call<ModelRouterState>('switch-active', { modelId, providerId }),
  reorder: (modelId: string, order: string[]) =>
    call<ModelRouterState>('reorder', { modelId, order }),
  refresh: () => call<ModelRouterState>('refresh'),
  setShowQuickSwitch: (value: boolean) =>
    call<ModelRouterState>('set-show-quick-switch', { value }),
  setIgnoreModelIdPrefix: (value: boolean) =>
    call<ModelRouterState>('set-ignore-model-id-prefix', { value }),
}
