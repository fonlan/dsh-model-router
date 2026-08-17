import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ClientContext, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconRightUpOutline16, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { api, type ModelRouterState, type RouterModelView } from './api'
import { LOCALE_NS } from './locales'
import './route-switcher.css'

const ROUTER_PROVIDER_ID = 'model-router'

interface RouteSwitcherInjected {
  available: boolean
  directory: SnapshotStore<ModelDirectoryState>
  load: () => void
}

type RouteSwitcherProps = PropsRuntime<'conversation.input.right'>
  & PropsLocale<typeof LOCALE_NS>
  & RouteSwitcherInjected

type RouteProvider = RouterModelView['providers'][number]

/**
 * The quick route switcher lives beside DSH's model seat in the composer row.
 * It reads the same per-session model directory as the host model picker, but
 * only appears when the selected model is the virtual model-router route.
 */
export function RouteSwitcher({
  session,
  available,
  directory,
  load,
  t,
}: RouteSwitcherProps): JSX.Element | null {
  const directoryState = useSyncExternalStore(
    onChange => directory.subscribe(onChange),
    () => directory.getSnapshot(),
    () => directory.getSnapshot(),
  )
  const current = directoryState.current
  const [routerState, setRouterState] = useState<ModelRouterState | null>(null)
  const [routerLoading, setRouterLoading] = useState(false)
  const [routerError, setRouterError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [busyProvider, setBusyProvider] = useState<string | null>(null)

  const isRouterModel = available && current?.provider === ROUTER_PROVIDER_ID
  const modelId = isRouterModel ? current.model : null

  const loadRouterState = useCallback(async () => {
    setRouterLoading(true)
    try {
      setRouterState(await api.state())
      setRouterError(null)
    } catch (cause) {
      setRouterError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRouterLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!available) return
    load()
  }, [available, load])

  // Fetch the global toggle (and the model's provider list) on mount too, so a
  // "hide quick switcher" setting applies even before the model directory
  // settles. The button stays visible while the value is unknown (default on).
  useEffect(() => {
    if (!available) return
    void loadRouterState()
  }, [available])

  useEffect(() => {
    setOpen(false)
    setBusyProvider(null)
    setRouterState(null)
    setRouterError(null)
  }, [modelId])

  // The model-selection directory is refreshed when another session changes
  // the router settings document. Re-read the global router state after that
  // refresh so this button never shows a stale active provider. Include the
  // model id: switching between two router models can leave the directory in
  // the same ready state while changing the API row we need to display.
  useEffect(() => {
    if (!isRouterModel || modelId === null || directoryState.status !== 'ready') return
    void loadRouterState()
  }, [directoryState.status, isRouterModel, loadRouterState, modelId])

  const routeModel = useMemo(
    () => modelId === null
      ? undefined
      : routerState?.models.find(model => model.id === modelId),
    [modelId, routerState],
  )

  const providers = useMemo(() => {
    if (routeModel === undefined) return []
    const byId = new Map(routeModel.providers.map(provider => [provider.id, provider]))
    const ordered = routeModel.order
      .map(id => byId.get(id))
      .filter((provider): provider is RouteProvider => provider !== undefined)
    const seen = new Set(ordered.map(provider => provider.id))
    return [...ordered, ...routeModel.providers.filter(provider => !seen.has(provider.id))]
  }, [routeModel])

  const switchProvider = useCallback(async (providerId: string) => {
    if (modelId === null || routeModel === undefined || routeModel.active === providerId) {
      setOpen(false)
      return
    }
    setBusyProvider(providerId)
    try {
      const next = await api.switchActive(modelId, providerId)
      setRouterState(next)
      setRouterError(null)
      setOpen(false)
      // The model directory also listens for settings updates, but an explicit
      // refresh keeps the host model picker description in sync immediately.
      load()
    } catch (cause) {
      setRouterError(t('switchFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      setBusyProvider(null)
    }
  }, [load, modelId, routeModel, t])

  if (session.removed || !isRouterModel) return null
  if (routerState?.showQuickSwitch === false) return null

  const activeProvider = providers.find(provider => provider.id === routeModel?.active)
  const activeName = activeProvider?.name ?? routeModel?.active ?? t('routeLoading')
  if (routeModel !== undefined && providers.length < 2) return null

  const menuItems: MenuEntry[] = routeModel === undefined
    ? [{
        type: 'label',
        id: 'route-status',
        text: routerError ?? t('routeLoading'),
      }]
    : [
        {
          type: 'label',
          id: 'route-model',
          text: t('routeMenuTitle', { model: modelId }),
        },
        ...providers.map(provider => ({
          id: provider.id,
          label: (
            <span className="mr-route-item-copy">
              <span className="mr-route-item-name">{provider.name}</span>
              {!provider.credentialConfigured && (
                <span className="mr-route-item-note">{t('noCredentialShort')}</span>
              )}
            </span>
          ),
          disabled: !provider.credentialConfigured || busyProvider !== null,
        })),
        ...(routerError === null ? [] : [{
          id: 'route-error',
          label: routerError,
          disabled: true,
          danger: true,
        }]),
      ]

  return (
    <Menu
      className="mr-route-anchor"
      open={open}
      side="top"
      align="end"
      portal
      compact
      dense
      items={menuItems}
      selectedId={routeModel?.active ?? undefined}
      onSelect={id => {
        if (id === 'route-error' || routeModel === undefined) {
          void loadRouterState()
          load()
          return
        }
        void switchProvider(id)
      }}
      onClose={() => setOpen(false)}
      footer={[
        {
          type: 'label',
          id: 'route-global-hint',
          text: t('globalRouteHint'),
        },
      ]}
      anchor={(
        <button
          type="button"
          className="mr-route-trigger"
          aria-label={t('routeButtonAria', { provider: activeName })}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={routerLoading || busyProvider !== null}
          onClick={() => {
            setOpen(value => !value)
            if (!open) {
              void loadRouterState()
              load()
            }
          }}
          title={t('routeButtonTitle')}
        >
          <IconRightUpOutline16 size={15} />
          <span className="mr-route-trigger-label">{activeName}</span>
        </button>
      )}
    />
  )
}

/** Register the quick route switcher into the composer right-side tool row. */
export function registerRouteSwitcher(ctx: ClientContext): void {
  const t = ctx.locale.bind(LOCALE_NS)
  ctx.inject(['slots', 'modelDirectories'], scope => {
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.slots.inject('conversation.input.right', () => scope.slots.register({
      name: 'conversation.input.right',
      id: 'model-router-route-switcher',
      order: 100,
      label: () => t('routeButtonLabel'),
      locale: LOCALE_NS,
      inject: (sessionId) => {
        const directory = models.directoryFor(sessionId)
        const available = sessions.subagentAddress(sessionId) === undefined
        return {
          available,
          directory: directory.store,
          load: () => {
            if (available) directory.load().catch(() => {})
          },
        }
      },
    }, RouteSwitcher as never))
  })
}