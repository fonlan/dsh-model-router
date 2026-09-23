/**
 * The Model Router settings page (设置 → 侧栏「模型路由」).
 *
 * Registers into the settings.section slot, so the page owns one entry in the
 * settings sidebar and renders its content in the panel's content column. The
 * page draws its own static header (title plus a one-line summary) over the
 * router controls: every routed model with its providers, their order and the
 * provider the model currently routes to. All reads/mutations go through the
 * plugin's fenced API; the server persists into this plugin's loader-entry
 * config (dsh >= 0.1.7), so a switch here is live for the next request
 * globally.
 *
 * The page needs no settings service: whether the deployment can persist is
 * reported by the API itself (`state.writable`), so the page registers and
 * mounts everywhere the host half serves its API. A read-only deployment
 * shows the banner and disables the mutation controls.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
type ClientContext = Context
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { LOCALE_NS } from './locales'
import { api, type ModelRouterState, type ModelSortMode, type RouterModelView } from './api'
import './settings-section.css'

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

export function makeSettingsSection(ctx: ClientContext): () => JSX.Element {
  // Bound translation is namespace-typed; the page's props use the plain
  // Translate face (string keys), which the dict satisfies structurally.
  const t: Translate = (() => {
    try {
      return ctx.locale.bind(LOCALE_NS) as unknown as Translate
    } catch {
      return (key: string) => key
    }
  })()

  return function ModelRouterSettingsSection(): JSX.Element {
    useLocaleRevision(ctx)
    const [state, setState] = useState<ModelRouterState | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [busyModel, setBusyModel] = useState<string | null>(null)
    const [drag, setDrag] = useState<{ modelId: string; index: number } | null>(null)
    const [quickSwitchBusy, setQuickSwitchBusy] = useState(false)
    const [ignorePrefixBusy, setIgnorePrefixBusy] = useState(false)
    const [sortBusy, setSortBusy] = useState(false)
    const [modelDrag, setModelDrag] = useState<{ index: number } | null>(null)

    const load = useCallback(async () => {
      setLoading(true)
      try {
        const next = await api.state()
        setState(next)
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

    const changeModelSort = useCallback(async (mode: ModelSortMode) => {
      if (state === null || state.modelSort === mode) return
      const previous = state.modelSort
      setState(prev => prev === null ? prev : { ...prev, modelSort: mode })
      setSortBusy(true)
      try {
        setState(await api.setModelSort(mode))
        setError(null)
      } catch (cause) {
        setState(prev => prev === null ? prev : { ...prev, modelSort: previous })
        setError(t('sortFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
      } finally {
        setSortBusy(false)
      }
    }, [state, t])

    const moveModel = useCallback(async (from: number, to: number) => {
      if (state === null || from === to) return
      // The drag list shows the full display order (modelOrder + catalog
      // tail); persist the whole reordered id list as the new custom order.
      const ids = state.models.map(model => model.id)
      const order = arrayMove(ids, from, to)
      setState(prev => prev === null ? prev : { ...prev, modelOrder: order })
      setSortBusy(true)
      try {
        setState(await api.setModelOrder(order))
        setError(null)
      } catch (cause) {
        setState(prev => prev === null ? prev : { ...prev, modelOrder: state.modelOrder })
        setError(t('sortFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
      } finally {
        setSortBusy(false)
      }
    }, [state, t])

    // Persistence capability is reported by the host half through the API
    // itself. A host that predates the field reads as writable: the page must
    // not block edits (with a wrong "read-only" banner) merely because the
    // host half and the client bundle are briefly out of step.
    const writable = state?.writable ?? true

    const models = useMemo(() => state?.models ?? [], [state])

    return (
      <div className="mr-page">
        <header className="mr-page-head">
          <h3 className="mr-page-title">{t('settingsTitle')}</h3>
          <p className="mr-page-sub">{t('sectionSub')}</p>
        </header>
        <div className="mr-body">
          {!loading && state !== null && !writable && (
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
            <div className="mr-sort">
              <div className="mr-sort-head">
                <span className="mr-sort-title">{t('sortTitle')}</span>
                <span className="mr-sort-desc">{t('sortDescription')}</span>
              </div>
              <div className="mr-sort-modes" role="radiogroup" aria-label={t('sortTitle')}>
                {(['custom', 'name', 'recent'] as const).map(mode => (
                  <label key={mode} className="mr-sort-mode">
                    <input
                      type="radio"
                      name="mr-model-sort"
                      checked={state?.modelSort === mode}
                      disabled={loading || sortBusy || !writable}
                      onChange={() => void changeModelSort(mode)}
                    />
                    <span className="mr-sort-mode-copy">
                      <span className="mr-sort-mode-label">{t(`sortMode${mode[0].toUpperCase()}${mode.slice(1)}`)}</span>
                      <span className="mr-sort-mode-desc">{t(`sortModeDesc${mode[0].toUpperCase()}${mode.slice(1)}`)}</span>
                    </span>
                  </label>
                ))}
              </div>
              {state?.modelSort === 'custom' && (
                <div className="mr-sort-custom">
                  <p className="mr-sort-hint">{t('sortCustomHint')}</p>
                  <ol className="mr-sort-list">
                    {models.map((model, index) => {
                      const dropTarget = modelDrag !== null && modelDrag.index !== index
                      return (
                        <li
                          key={model.id}
                          className={[
                            'mr-sort-item',
                            dropTarget ? 'mr-sort-item-drop' : '',
                            sortBusy ? 'mr-sort-item-busy' : '',
                          ].filter(Boolean).join(' ')}
                          draggable={!sortBusy && writable}
                          onDragStart={(event) => {
                            setModelDrag({ index })
                            event.dataTransfer.effectAllowed = 'move'
                            try {
                              event.dataTransfer.setData('text/plain', model.id)
                            } catch {
                              // drag data is cosmetic for our own handler
                            }
                          }}
                          onDragOver={(event) => {
                            if (modelDrag !== null && modelDrag.index !== index) {
                              event.preventDefault()
                              event.dataTransfer.dropEffect = 'move'
                            }
                          }}
                          onDrop={(event) => {
                            if (modelDrag !== null && modelDrag.index !== index) {
                              event.preventDefault()
                              moveModel(modelDrag.index, index)
                            }
                            setModelDrag(null)
                          }}
                          onDragEnd={() => setModelDrag(null)}
                        >
                          <span className="mr-grip" aria-hidden="true">⠿</span>
                          <span className="mr-sort-model-name">{model.name}</span>
                          <span className="mr-sort-model-id">{model.id}</span>
                        </li>
                      )
                    })}
                  </ol>
                </div>
              )}
            </div>
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
      </div>
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
