import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type { ClientContext, SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconWarningOutline16,
  Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { api, type ModelRouterState, type RouterModelView } from './api'
import { LOCALE_NS } from './locales'
import './model-seat.css'

const ROUTER_PROVIDER_ID = 'model-router'

/**
 * Minimal structural ModelSelection (wire shape: provider / model /
 * reasoningEffort). Declared locally to avoid pulling a new peer dependency
 * for a type-only surface; structurally identical to the host wire type.
 */
interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** The injected business face of the composer model seat (same share the host ModelSelect receives). */
interface ModelSeatInjected {
  available: boolean
  directory: SnapshotStore<ModelDirectoryState>
  load: () => void
  select: (selection: ModelSelection) => Promise<boolean>
}

type ModelSeatProps = PropsRuntime<'conversation.input.model'>
  & ModelSeatInjected
  & PropsLocale<typeof LOCALE_NS>

type RouteProvider = RouterModelView['providers'][number]

/**
 * The composer model seat, shadowing the host ModelSelect at a lower slot
 * priority. It renders the same two-level Model / Effort menu as the host
 * (model list grouped by provider, reasoning effort levels), plus a third
 * Provider row that opens the model-router provider list — the former quick
 * route-switcher button moved into the model picker, on par with the model
 * and effort menus.
 *
 * Shadowing contract: the host ui-model-selection registers the
 * `conversation.input.model` occupant at priority 0; this entry registers at
 * priority -1, so the renderer projects this component as the single-slot
 * winner while the host entry stays as the abdication fallback. Both entries
 * share the same per-session ModelDirectory, so selections stay consistent
 * with the /model popup and the host picker.
 */
export function ModelRouterSeat({
  locked,
  available,
  directory,
  load,
  select,
  t,
}: ModelSeatProps): JSX.Element | null {
  const directoryState = useSyncExternalStore(
    onChange => directory.subscribe(onChange),
    () => directory.getSnapshot(),
    () => directory.getSnapshot(),
  )
  const current = directoryState.current

  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<'root' | 'model' | 'provider' | 'effort'>('root')
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  // ---- model-router state (moved from the quick route switcher) ----
  const [routerState, setRouterState] = useState<ModelRouterState | null>(null)
  const [routerLoading, setRouterLoading] = useState(false)
  const [routerError, setRouterError] = useState<string | null>(null)
  const [busyProvider, setBusyProvider] = useState<string | null>(null)

  const isRouterModel = available && current?.provider === ROUTER_PROVIDER_ID
  const modelId = isRouterModel ? current.model : null

  const loadRouterState = useCallback(async (silent = false) => {
    if (!silent) setRouterLoading(true)
    try {
      setRouterState(await api.state())
      setRouterError(null)
    } catch (cause) {
      setRouterError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!silent) setRouterLoading(false)
    }
  }, [])

  // Load the advisory directory on mount (host behavior).
  useEffect(() => {
    if (!available) return
    load()
  }, [available, load])

  // Fetch the router state (and thus the global toggle) on mount too, so the
  // "hide provider switching" setting applies as soon as it resolves.
  useEffect(() => {
    if (!available) return
    void loadRouterState()
  }, [available, loadRouterState])

  // Reset the open pane when the selected model changes (a different model may
  // no longer be a model-router route).
  useEffect(() => {
    setPane('root')
    setBusyProvider(null)
    setRouterError(null)
  }, [modelId])

  // Silent debounced refresh of the router state after directory refreshes
  // (settings edits, adapter updates), so the provider row never shows a stale
  // active provider.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!isRouterModel || modelId === null || directoryState.status !== 'ready') return
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      void loadRouterState(true)
    }, 300)
    return () => {
      if (refreshTimer.current !== null) clearTimeout(refreshTimer.current)
      refreshTimer.current = null
    }
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
      // Keep the host model picker description in sync immediately.
      load()
    } catch (cause) {
      setRouterError(t('switchFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      setBusyProvider(null)
    }
  }, [load, modelId, routeModel, t])

  // ---- host ModelSelect logic (faithful copy) ----
  const choices = useMemo(() => directoryState.groups.flatMap(group => group.models.map(model => ({
    group,
    model,
    selection: {
      provider: group.id,
      model: model.id,
      ...model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort },
    },
  }))), [directoryState.groups])
  const currentChoice = choices[current === null ? -1 : choices.findIndex(c =>
    c.selection.provider === current?.provider && c.selection.model === current.model)]
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined ? undefined
    : effectiveEffort === undefined ? t('effortProviderDefault')
    : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<Array<{ key: string; effort: string | undefined; label: string; description?: string }>>(() => reasoning === undefined ? [] : [
    ...(reasoning.defaultEffort === undefined ? [{
      key: 'provider-default',
      effort: undefined as string | undefined,
      label: t('effortProviderDefault'),
    }] : []),
    ...reasoning.efforts.map(effort => ({
      key: `effort:${effort.id}`,
      effort: effort.id,
      label: effort.name,
      ...effort.description === undefined ? {} : { description: effort.description },
    })),
  ], [reasoning, t])

  const busy = directoryState.status === 'selecting'
  const reload = () => {
    lastActionRef.current = 'load'
    load()
  }

  // Close on outside mousedown (host behavior).
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
    }
  }, [open])

  if (!available) return null

  const show = () => {
    setPane('root')
    setOpen(true)
    reload()
    void loadRouterState()
  }
  const close = (restoreFocus = false) => {
    setOpen(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => {
      triggerRef.current?.focus()
    })
  }
  const moveFocus = (offset: number) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    items[(Math.max(active, 0) + offset + items.length) % items.length]?.focus()
  }
  const onRootKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      if (pane !== 'root') setPane('root')
      else close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }
  const onBlur = (event: ReactFocusEvent) => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }
  const settleSelection = (accepted: boolean) => {
    if (accepted) {
      if (rootRef.current !== null) close(true)
      return
    }
    const message = directory.getSnapshot().error
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('errorAction', { message }) })
    }
  }
  const choose = (selection: ModelSelection) => {
    if (current !== null && current.provider === selection.provider && current.model === selection.model) {
      close(true)
      return
    }
    lastActionRef.current = 'select'
    select(selection).then(settleSelection)
  }
  const chooseEffort = (effort: string | undefined) => {
    if (current === null) return
    if (effectiveEffort === effort) {
      close(true)
      return
    }
    const selection: ModelSelection = {
      provider: current.provider,
      model: current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    select(selection).then(settleSelection)
  }

  const modelLabel = currentChoice?.model.name ?? t('triggerFallback')
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const triggerAria = currentChoice === undefined ? t('triggerSelectAria')
    : effortLabel === undefined ? t('triggerAria', { model: modelLabel })
    : t('triggerAriaEffort', { model: modelLabel, effort: effortLabel })

  // ---- provider row visibility (the former quick-switch button conditions) ----
  const activeProvider = providers.find(provider => provider.id === routeModel?.active)
  const activeProviderName = activeProvider?.name ?? routeModel?.active ?? t('routeLoading')
  const providerRowVisible = isRouterModel
    && routerState !== null
    && routerState.showQuickSwitch !== false
    && routerState.providers.length >= 2
    && routeModel !== undefined
    && providers.length >= 2

  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => {
      itemRefs.current[at] = node
    }
  }

  return (
    <div
      ref={rootRef}
      className="mr-seat-root"
      onKeyDown={onRootKeyDown}
      onBlur={onBlur}
    >
      <button
        ref={triggerRef}
        type="button"
        className="mr-seat-trigger"
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) close()
          else show()
        }}
      >
        <span className="mr-seat-triggerLabel">{modelLabel}</span>
        {effortLabel !== undefined && (
          <span className="mr-seat-triggerEffort">{effortLabel}</span>
        )}
        <span className={`mr-seat-chevron${open ? ' mr-seat-chevronOpen' : ''}`} aria-hidden>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          className="mr-seat-menu"
          role="menu"
          aria-label={t('menuAria')}
          aria-busy={directoryState.status === 'loading' || busy}
        >
          {pane === 'root' && (
            <>
              <button
                ref={itemRef()}
                type="button"
                role="menuitem"
                className="mr-seat-cell"
                onClick={() => setPane('model')}
              >
                <span className="mr-seat-cellLabel">{t('menuModel')}</span>
                <span className="mr-seat-cellValue">{modelLabel}</span>
                <span className="mr-seat-cellChevron" aria-hidden>
                  <IconChevronRightOutline14 />
                </span>
              </button>
              {providerRowVisible && (
                <button
                  ref={itemRef()}
                  type="button"
                  role="menuitem"
                  className="mr-seat-cell"
                  onClick={() => setPane('provider')}
                >
                  <span className="mr-seat-cellLabel">{t('menuProvider')}</span>
                  <span className="mr-seat-cellValue">{activeProviderName}</span>
                  <span className="mr-seat-cellChevron" aria-hidden>
                    <IconChevronRightOutline14 />
                  </span>
                </button>
              )}
              {reasoning !== undefined && (
                <button
                  ref={itemRef()}
                  type="button"
                  role="menuitem"
                  className="mr-seat-cell"
                  onClick={() => setPane('effort')}
                >
                  <span className="mr-seat-cellLabel">{t('menuEffort')}</span>
                  <span className="mr-seat-cellValue">{effortLabel}</span>
                  <span className="mr-seat-cellChevron" aria-hidden>
                    <IconChevronRightOutline14 />
                  </span>
                </button>
              )}
            </>
          )}
          {pane === 'model' && (
            <>
              {directoryState.status === 'loading' && (
                <div className="mr-seat-status">{t('statusLoading')}</div>
              )}
              {directoryState.error !== null && lastActionRef.current === 'load' && (
                <div className="mr-seat-error">
                  <span>{t('errorAction', { message: directoryState.error })}</span>
                  <button type="button" className="mr-seat-retry" onClick={reload}>
                    {t('retry')}
                  </button>
                </div>
              )}
              {directoryState.failures.map(failure => (
                <div key={failure.id} className="mr-seat-warning">
                  <span>{t('warningGroupLoad', { name: failure.name, message: failure.message })}</span>
                  <button type="button" className="mr-seat-retry" onClick={reload}>
                    {t('retry')}
                  </button>
                </div>
              ))}
              <div className="mr-seat-groups">
                {directoryState.groups.map(group => {
                  const headingId = `${id}-${group.id}`
                  return (
                    <section
                      key={group.id}
                      role="group"
                      aria-labelledby={headingId}
                      className="mr-seat-group"
                    >
                      <div className="mr-seat-groupTitle" id={headingId}>
                        {group.name}
                      </div>
                      {group.models.map(model => {
                        const selected = current?.provider === group.id && current.model === model.id
                        return (
                          <button
                            key={model.id}
                            ref={itemRef()}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={`mr-seat-option${selected ? ' mr-seat-selected' : ''}`}
                            title={model.name}
                            disabled={busy}
                            onClick={() => choose({ provider: group.id, model: model.id })}
                          >
                            <span className="mr-seat-optionCopy">
                              <span className="mr-seat-modelName">{model.name}</span>
                              {model.description !== undefined && (
                                <span className="mr-seat-description">{model.description}</span>
                              )}
                            </span>
                            <span className="mr-seat-check" aria-hidden>
                              {selected ? <IconCheckOutline16 /> : null}
                            </span>
                          </button>
                        )
                      })}
                    </section>
                  )
                })}
              </div>
              {directoryState.status === 'ready' && choices.length === 0 && (
                <div className="mr-seat-empty">{t('emptyModels')}</div>
              )}
            </>
          )}
          {pane === 'provider' && (
            <>
              {routerError !== null && (
                <div className="mr-seat-error">
                  <span>{routerError}</span>
                  <button
                    type="button"
                    className="mr-seat-retry"
                    onClick={() => {
                      void loadRouterState()
                      load()
                    }}
                  >
                    {t('retry')}
                  </button>
                </div>
              )}
              {routeModel === undefined ? (
                <div className="mr-seat-status">{t('routeLoading')}</div>
              ) : (
                <>
                  <div className="mr-seat-title">{t('routeMenuTitle', { model: modelId ?? '' })}</div>
                  <div className="mr-seat-groups">
                    {providers.map(provider => {
                      const selected = routeModel.active === provider.id
                      return (
                        <button
                          key={provider.id}
                          ref={itemRef()}
                          type="button"
                          role="menuitemradio"
                          aria-checked={selected}
                          className={`mr-seat-option${selected ? ' mr-seat-selected' : ''}`}
                          disabled={!provider.credentialConfigured || busyProvider !== null}
                          onClick={() => void switchProvider(provider.id)}
                        >
                          <span className="mr-seat-optionCopy">
                            <span className="mr-seat-modelName">{provider.name}</span>
                            {!provider.credentialConfigured && (
                              <span className="mr-seat-description">{t('noCredentialShort')}</span>
                            )}
                          </span>
                          <span className="mr-seat-check" aria-hidden>
                            {selected ? <IconCheckOutline16 /> : null}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="mr-seat-hint">{t('globalRouteHint')}</div>
                </>
              )}
            </>
          )}
          {pane === 'effort' && (
            <>
              {directoryState.error !== null && lastActionRef.current === 'load' && (
                <div className="mr-seat-error">
                  <span>{t('errorAction', { message: directoryState.error })}</span>
                  <button type="button" className="mr-seat-retry" onClick={reload}>
                    {t('actionReload')}
                  </button>
                </div>
              )}
              {effortChoices.length === 0 ? (
                <div className="mr-seat-empty">{t('emptyEfforts')}</div>
              ) : effortChoices.map(level => (
                <button
                  key={level.key}
                  ref={itemRef()}
                  type="button"
                  role="menuitemradio"
                  aria-checked={effectiveEffort === level.effort}
                  className={`mr-seat-option${effectiveEffort === level.effort ? ' mr-seat-selected' : ''}`}
                  disabled={busy}
                  onClick={() => chooseEffort(level.effort)}
                >
                  <span className="mr-seat-optionCopy">
                    <span className="mr-seat-modelName">{level.label}</span>
                    {level.description !== undefined && (
                      <span className="mr-seat-description">{level.description}</span>
                    )}
                  </span>
                  <span className="mr-seat-check" aria-hidden>
                    {effectiveEffort === level.effort ? <IconCheckOutline16 /> : null}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest('[data-composer-card]') ?? null}
          onDone={() => setToast(null)}
        />
      )}
    </div>
  )
}

/** Register the model seat onto the composer's named model slot (priority -1 shadows the host seat). */
export function registerModelRouterSeat(ctx: ClientContext): void {
  const t = ctx.locale.bind(LOCALE_NS)
  ctx.inject(['slots', 'modelDirectories'], scope => {
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model',
      id: 'model-router-model-seat',
      priority: -1,
      label: () => t('seatLabel'),
      locale: LOCALE_NS,
      inject: (sessionId: SessionId) => {
        const directory = models.directoryFor(sessionId)
        const available = sessions.subagentAddress(sessionId) === undefined
        return {
          available,
          directory: directory.store,
          load: () => {
            if (available) directory.load().catch(() => {})
          },
          select: (selection: ModelSelection) =>
            available ? directory.select(selection).then(() => true, () => false) : Promise.resolve(false),
        }
      },
    } as never, ModelRouterSeat as never))
  })
}
