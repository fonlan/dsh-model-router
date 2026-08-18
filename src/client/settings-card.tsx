/**
 * The Model Router Settings Card (设置 → 插件 → 插件配置 → 模型路由).
 *
 * Renders its own expandable chrome aligned with the built-in plugin cards
 * (external plugins cannot import PluginCard): a header naming the plugin and
 * what its settings govern, disclosing the router controls in place. All
 * reads/mutations go through the plugin's fenced API; the server persists
 * through the `model-router` settings namespace, so a switch here is live for
 * the next request globally.
 *
 * The bound settings scope (the same `model-router` namespace the host half
 * registers) supplies the card's dispatch state: while the namespace is merely
 * loading the card stays mounted, and when it is unavailable (deployment
 * without the host half) nothing renders — matching the built-in cards. A
 * read-only deployment shows the built-in card's banner and disables the
 * mutation controls.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { LOCALE_NS } from './locales'
import { api, type ModelRouterState, type RouterModelView } from './api'
import './settings-card.css'

/** Client settings scope face (subset of @deepseek-ai/dsh-client-runtime). */
export interface SettingsScopeFace {
  getSnapshot(): {
    status: 'loading' | 'ready' | 'unavailable'
    writable: boolean
  }
  subscribe(listener: () => void): () => void
}

export interface SettingsCardProps {
  /** The bound `model-router` settings scope (from the slot entry's inject face). */
  scope: SettingsScopeFace
}

function arrayMove<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

function useLocaleRevision(ctx: ClientContext): number {
  const subscribe = useCallback(
    (onChange: () => void) => {
      try {
        return ctx.locale.subscribe(onChange)
      } catch {
        return () => {}
      }
    },
    [ctx],
  )
  const getSnapshot = useCallback(() => {
    try {
      return ctx.locale.getLocale().revision
    } catch {
      return 0
    }
  }, [ctx])
  return useSyncExternalStore(subscribe, getSnapshot)
}

export function makeSettingsCard(ctx: ClientContext): (props: SettingsCardProps) => JSX.Element | null {
  // Bound translation is namespace-typed; the card's props use the plain
  // Translate face (string keys), which the dict satisfies structurally.
  const t: Translate = (() => {
    try {
      return ctx.locale.bind(LOCALE_NS) as unknown as Translate
    } catch {
      return (key: string) => key
    }
  })()

  return function ModelRouterSettingsCard(props: SettingsCardProps): JSX.Element | null {
    const { scope } = props
    // Bind the methods: React invokes getSnapshot/subscribe as bare functions,
    // and SettingsScopeController's methods depend on `this`.
    const snapshot = useSyncExternalStore(
      (listener) => scope.subscribe(listener),
      () => scope.getSnapshot(),
    )
    useLocaleRevision(ctx)
    // Card-local disclosure: collapsed by default, like the built-in plugin cards.
    const [open, setOpen] = useState(false)
    const [state, setState] = useState<ModelRouterState | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [busyModel, setBusyModel] = useState<string | null>(null)
    const [drag, setDrag] = useState<{ modelId: string; index: number } | null>(null)
    const [quickSwitchBusy, setQuickSwitchBusy] = useState(false)
    const [ignorePrefixBusy, setIgnorePrefixBusy] = useState(false)

    const load = useCallback(async () => {
      setLoading(true)
      try {
        setState(await api.state())
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setLoading(false)
      }
    }, [])

    useEffect(() => {
      void load()
    }, [load])

    const switchActive = useCallback(async (model: RouterModelView, providerId: string) => {
      if (model.active === providerId) return
      setBusyModel(model.id)
      try {
        setState(await api.switchActive(model.id, providerId))
        setError(null)
      } catch (cause) {
        setError(t('switchFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
      } finally {
        setBusyModel(null)
      }
    }, [t])

    const reorder = useCallback(async (model: RouterModelView, from: number, to: number) => {
      if (from === to) return
      const order = arrayMove(model.order, from, to)
      setState(prev => prev === null ? prev : {
        ...prev,
        models: prev.models.map(m => (m.id === model.id ? { ...m, order } : m)),
      })
      setBusyModel(model.id)
      try {
        setState(await api.reorder(model.id, order))
        setError(null)
      } catch (cause) {
        setError(t('reorderFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
        setState(prev => prev === null ? prev : {
          ...prev,
          models: prev.models.map(m => (m.id === model.id ? { ...m, order: model.order } : m)),
        })
      } finally {
        setBusyModel(null)
      }
    }, [t])

    const toggleQuickSwitch = useCallback(async (value: boolean) => {
      if (state === null) return
      const previous = state.showQuickSwitch
      setState(prev => prev === null ? prev : { ...prev, showQuickSwitch: value })
      setQuickSwitchBusy(true)
      try {
        setState(await api.setShowQuickSwitch(value))
        setError(null)
      } catch (cause) {
        setState(prev => prev === null ? prev : { ...prev, showQuickSwitch: previous })
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setQuickSwitchBusy(false)
      }
    }, [state])

    const toggleIgnorePrefix = useCallback(async (value: boolean) => {
      if (state === null) return
      const previous = state.ignoreModelIdPrefix
      setState(prev => prev === null ? prev : { ...prev, ignoreModelIdPrefix: value })
      setIgnorePrefixBusy(true)
      try {
        setState(await api.setIgnoreModelIdPrefix(value))
        setError(null)
      } catch (cause) {
        setState(prev => prev === null ? prev : { ...prev, ignoreModelIdPrefix: previous })
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setIgnorePrefixBusy(false)
      }
    }, [state])

    // The namespace is served by the host once the scope is ready. While it is
    // merely loading, keep the card mounted (the tab already dispatched it);
    // if it is unavailable (deployment without the host half), render nothing.
    if (snapshot.status === 'unavailable') return null
    const writable = snapshot.writable

    const models = useMemo(() => state?.models ?? [], [state])

    return (
      <li className="mr-settings-card" data-open={open ? '' : undefined}>
        <button
          type="button"
          className="mr-settings-head"
          aria-expanded={open}
          aria-label={(open ? t('collapse') : t('expand')) + '：' + t('settingsTitle')}
          onClick={() => setOpen(!open)}
        >
          <span className="mr-settings-head-text">
            <span className="mr-settings-title">{t('settingsTitle')}</span>
            <span className="mr-settings-sub">{t('settingsCardDescription')}</span>
          </span>
          <span className="mr-settings-chevron" data-open={open ? '' : undefined} aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        {open && (
          <div className="mr-settings-body">
            {!writable && (
              <p className="mr-settings-readonly" role="status">{t('readOnly')}</p>
            )}
            <div className="mr-root">
              <label className="mr-quick-switch">
                <input
                  type="checkbox"
                  checked={state?.showQuickSwitch ?? true}
                  disabled={loading || quickSwitchBusy || !writable}
                  onChange={(event) => void toggleQuickSwitch(event.target.checked)}
                />
                <span className="mr-quick-switch-copy">
                  <span className="mr-quick-switch-label">{t('showQuickSwitchLabel')}</span>
                  <span className="mr-quick-switch-desc">{t('showQuickSwitchDescription')}</span>
                </span>
              </label>
              <label className="mr-quick-switch">
                <input
                  type="checkbox"
                  checked={state?.ignoreModelIdPrefix ?? true}
                  disabled={loading || ignorePrefixBusy || !writable}
                  onChange={(event) => void toggleIgnorePrefix(event.target.checked)}
                />
                <span className="mr-quick-switch-copy">
                  <span className="mr-quick-switch-label">{t('ignorePrefixLabel')}</span>
                  <span className="mr-quick-switch-desc">{t('ignorePrefixDescription')}</span>
                </span>
              </label>
              <div className="mr-toolbar">
                <span className="mr-count">{t('modelsCount', { count: models.length })}</span>
                <button type="button" className="mr-button" onClick={() => void load()} disabled={loading}>
                  {t('refresh')}
                </button>
              </div>
              {error !== null && (
                <div className="mr-error" role="alert">{error}</div>
              )}
              {loading && models.length === 0 && (
                <div className="mr-empty">{t('loading')}</div>
              )}
              {!loading && models.length === 0 && (
                <div className="mr-empty">{t('empty')}</div>
              )}
              <div className="mr-models">
                {models.map(model => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    t={t}
                    readOnly={!writable}
                    busy={busyModel === model.id}
                    dragging={drag}
                    onDragStart={index => setDrag({ modelId: model.id, index })}
                    onDragEnd={() => setDrag(null)}
                    onDrop={index => {
                      if (drag !== null && drag.modelId === model.id) {
                        void reorder(model, drag.index, index)
                      }
                      setDrag(null)
                    }}
                    onSwitch={providerId => void switchActive(model, providerId)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </li>
    )
  }
}

interface ModelCardProps {
  model: RouterModelView
  t: Translate
  readOnly: boolean
  busy: boolean
  dragging: { modelId: string; index: number } | null
  onDragStart: (index: number) => void
  onDragEnd: () => void
  onDrop: (index: number) => void
  onSwitch: (providerId: string) => void
}

function ModelCard(props: ModelCardProps): JSX.Element {
  const { model, t, readOnly, busy, dragging } = props
  return (
    <section className={`mr-card${busy ? ' mr-card-busy' : ''}`}>
      <header className="mr-card-header">
        <span className="mr-model-name">{model.name}</span>
        <span className="mr-model-id">{model.id}</span>
        <span className="mr-provider-count">{t('providerCount', { count: model.providers.length })}</span>
      </header>
      <p className="mr-drag-hint">{t('dragHint')}</p>
      <ul className="mr-providers">
        {model.providers.map((provider, index) => {
          const active = provider.id === model.active
          const selectable = provider.credentialConfigured
          const dropTarget = dragging !== null && dragging.modelId === model.id && dragging.index !== index
          return (
            <li
              key={provider.id}
              className={[
                'mr-provider',
                active ? 'mr-provider-active' : '',
                !selectable ? 'mr-provider-nocred' : '',
                dropTarget ? 'mr-provider-drop' : '',
              ].filter(Boolean).join(' ')}
              draggable={!busy && !readOnly && model.providers.length > 1}
              title={selectable ? undefined : t('noCredential')}
              onDragStart={(event) => {
                props.onDragStart(index)
                event.dataTransfer.effectAllowed = 'move'
                try {
                  event.dataTransfer.setData('text/plain', model.id)
                } catch {
                  // drag data is cosmetic for our own handler
                }
              }}
              onDragOver={(event) => {
                if (dragging !== null && dragging.modelId === model.id && dragging.index !== index) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }
              }}
              onDrop={(event) => {
                if (dragging !== null && dragging.modelId === model.id) {
                  event.preventDefault()
                  props.onDrop(index)
                }
              }}
              onDragEnd={() => props.onDragEnd()}
            >
              <span className="mr-grip" aria-hidden="true">⠿</span>
              <button
                type="button"
                className="mr-provider-button"
                disabled={!selectable || busy || active || readOnly}
                onClick={() => props.onSwitch(provider.id)}
              >
                <span className="mr-provider-name">{provider.name}</span>
                {!selectable && <span className="mr-provider-nocred-label">· {t('noCredential')}</span>}
              </button>
              {active && <span className="mr-active-badge">{t('activeBadge')}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
