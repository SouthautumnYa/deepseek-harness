/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Two-level selection per figma 496:26454's MenuDropdown: the root menu is
 * the Model / Effort row pair (label + current value + a right chevron),
 * each drilling into its own list — the provider-grouped model list over
 * the shared directory, and the effort levels. The trigger (313:14108's
 * ToggleButton) shows both: model name + effort in the caption tone.
 * Data and submission ride the SAME per-session ModelDirectory as the
 * /model popup; exact-model reasoning metadata and the selected effort come
 * from the Host rather than a client-owned vocabulary. A rejected selection
 * announces through the shared transient Toast anchored to the composer
 * card; the in-menu strip with Retry remains the catalog-load surface.
 */
import {
  useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent, type FocusEvent,
} from 'react'
import clsx from 'clsx'
import type { ModelReasoningEffort, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconRefreshOutline16, IconWarningOutline16, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import css from './ModelSelect.module.css'

/** Which pane the dropdown shows: the root or one drilled-in list. */
type Pane = 'root' | 'model' | 'effort' | 'speed'

/** The dsh-model-modes plugin's existing DOM bridge for the Fast RPC state. */
interface FastBridgeState {
  available: boolean
  enabled: boolean
  busy: boolean
  status: 'unknown' | 'loading' | 'ready'
  reason: string | null
}

const EMPTY_FAST: FastBridgeState = {
  available: false,
  enabled: false,
  busy: false,
  status: 'unknown',
  reason: null,
}

const FAST_BUTTON_SELECTOR = '.dsh_modelModes_button'

function fastButtonFor(root: HTMLDivElement | null): HTMLButtonElement | null {
  const card = root?.closest<HTMLElement>('[data-composer-card]')
  return card?.querySelector<HTMLButtonElement>(FAST_BUTTON_SELECTOR) ?? null
}

function fastStateOf(button: HTMLButtonElement | null): FastBridgeState {
  if (button === null) return EMPTY_FAST
  const title = button.getAttribute('title') ?? ''
  const separator = title.indexOf(' — ')
  return {
    available: button.dataset.available === 'true',
    enabled: button.dataset.active === 'true',
    busy: button.getAttribute('aria-busy') === 'true' || button.disabled,
    status: button.getAttribute('aria-busy') === 'true' ? 'loading' : 'ready',
    reason: separator < 0 ? null : title.slice(separator + 3),
  }
}

function sameFastState(left: FastBridgeState, right: FastBridgeState): boolean {
  return left.available === right.available
    && left.enabled === right.enabled
    && left.busy === right.busy
    && left.status === right.status
    && left.reason === right.reason
}

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the two-level menu.
 */
export function ModelSelect(
  { locked, available, directory, load, select, t }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const focusRef = useRef<HTMLButtonElement | null>(null)
  const fastButtonRef = useRef<HTMLButtonElement | null>(null)
  const [fast, setFast] = useState<FastBridgeState>(EMPTY_FAST)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  const choices = useMemo(() => state.groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      } satisfies ModelSelection,
    }))), [state.groups])
  const selectedIndex = state.current === null
    ? -1
    : choices.findIndex(c => c.selection.provider === state.current?.provider && c.selection.model === state.current.model)
  const currentChoice = choices[selectedIndex]
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
        : [],
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
        ...effort.description === undefined ? {} : { description: effort.description },
      })),
    ], [reasoning, t])
  const busy = state.status === 'selecting'
  const speedLabel = fast.status === 'loading'
    ? t('speed.loading')
    : fast.available ? (fast.enabled ? t('speed.fast') : t('speed.standard')) : t('speed.unavailable')
  const effortOverridden = reasoning === undefined
    ? state.current?.reasoningEffort !== undefined
    : effectiveEffort !== reasoning.defaultEffort
  const canReset = state.current !== null && (effortOverridden || fast.enabled)

  // Fast is owned by dsh-model-modes. Its button is the already-mounted face
  // of the provider-native RPC; mirroring its data attributes keeps this
  // package independent of that optional plugin and preserves its exact
  // capability allowlist for third-party routes.
  useEffect(() => {
    const sync = (): void => {
      const button = fastButtonFor(rootRef.current)
      fastButtonRef.current = button
      const bridge = button?.closest<HTMLElement>('.dsh_modelModes_wrap')
      bridge?.setAttribute('aria-hidden', 'true')
      if (button !== null) button.tabIndex = -1
      const next = fastStateOf(button)
      setFast(previous => sameFastState(previous, next) ? previous : next)
    }
    sync()
    if (typeof MutationObserver === 'undefined') return
    const scope = rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? document.body
    const observer = new MutationObserver(sync)
    observer.observe(scope, {
      attributes: true,
      attributeFilter: ['aria-busy', 'data-active', 'data-available', 'disabled', 'title'],
      childList: true,
      subtree: true,
    })
    return () => { observer.disconnect() }
  }, [available])

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  // Mount-time load resolves the trigger label; every open refreshes.
  useEffect(() => {
    if (available) {
      lastActionRef.current = 'load'
      load()
    }
  }, [available, load])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  if (!available) return null

  const show = (nextPane: Pane = 'root', trigger: HTMLButtonElement | null = null): void => {
    setPane(nextPane)
    setOpen(true)
    focusRef.current = trigger ?? triggerRef.current
    reload()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => { focusRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Escape backs out of a drilled pane first, then closes.
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

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  const settleSelection = (accepted: boolean): void => {
    if (accepted) {
      if (rootRef.current !== null) close(true)
      return
    }
    const message = directory.getSnapshot().error
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
    }
  }

  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      close(true)
      return
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) {
      close(true)
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const fastAction = (enabled: boolean): boolean => {
    const button = fastButtonFor(rootRef.current)
    const current = fastStateOf(button)
    fastButtonRef.current = button
    if (button === null || !current.available || current.busy || current.enabled === enabled) return false
    button.click()
    return true
  }

  const chooseSpeed = (enabled: boolean): void => {
    const current = fastStateOf(fastButtonFor(rootRef.current))
    if (current.available && current.enabled === enabled) {
      close(true)
      return
    }
    if (fastAction(enabled)) close(true)
  }

  const resetDefaults = async (): Promise<void> => {
    if (state.current === null || !canReset || busy || fast.busy) return
    if (effortOverridden) {
      lastActionRef.current = 'select'
      const defaultSelection: ModelSelection = {
        provider: state.current.provider,
        model: state.current.model,
        ...reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: reasoning.defaultEffort },
      }
      const accepted = await select(defaultSelection)
      if (!accepted) {
        settleSelection(false)
        return
      }
    }
    if (fast.enabled && !fastAction(false)) return
    close(true)
  }

  const modelLabel = currentChoice?.model.name ?? t('trigger.fallback')
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  // The bolt is a state indicator, not a capability marker. Standard mode
  // keeps the speed menu available but must leave the trigger unadorned.
  const showFastIcon = fast.available && fast.enabled
  const triggerAria = currentChoice === undefined
    ? t('trigger.selectAria')
    : fast.available
      ? effortLabel === undefined
        ? t('trigger.ariaSpeed', { model: modelLabel, speed: speedLabel })
        : t('trigger.ariaEffortSpeed', { model: modelLabel, effort: effortLabel, speed: speedLabel })
      : effortLabel === undefined
        ? t('trigger.aria', { model: modelLabel })
        : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <div className={css.controls}>
        <button
          ref={triggerRef}
          type="button"
          className={css.trigger}
          aria-label={triggerAria}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? `${id}-menu` : undefined}
          title={triggerLabel}
          disabled={locked}
          onClick={() => {
            if (open) {
              close()
            } else {
              show('root', triggerRef.current)
            }
          }}
        >
          {showFastIcon && (
            <span
              className={clsx(
                css.fastIcon,
                fast.enabled && css.fastIconActive,
                !fast.available && css.fastIconUnavailable,
                fast.status === 'loading' && css.fastIconBusy,
              )}
              aria-hidden="true"
              data-fast-integrated
            >
              <svg viewBox="0 0 12 12" width="14" height="14">
                <path d="M6.8.8 2.4 6.3h3L4.9 11.2l4.7-6H6.5L6.8.8Z" fill="currentColor" />
              </svg>
            </span>
          )}
          <span className={css.triggerLabel}>{modelLabel}</span>
          {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
          <IconChevronDownOutline14 className={clsx(css.chevron, open && pane !== 'effort' && css.chevronOpen)} />
        </button>
      </div>

      {open && (
        <div
          id={`${id}-menu`}
          className={css.menu}
          role="menu"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy || fast.busy}
        >
          {pane === 'root' && (
            <>
              <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('model') }}>
                <span className={css.cellLabel}>{t('menu.model')}</span>
                <span className={css.cellValue}>{modelLabel}</span>
                <IconChevronRightOutline14 className={css.cellChevron} />
              </button>
              {reasoning !== undefined && (
                <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('effort') }}>
                  <span className={css.cellLabel}>{t('menu.effort')}</span>
                  <span className={css.cellValue}>{effortLabel}</span>
                  <IconChevronRightOutline14 className={css.cellChevron} />
                </button>
              )}
              <button
                ref={itemRef()}
                type="button"
                role="menuitem"
                className={clsx(css.cell, !fast.available && css.cellDisabled)}
                disabled={fast.status !== 'ready' || !fast.available || fastButtonRef.current === null || fast.busy}
                onClick={() => { setPane('speed') }}
              >
                <span className={css.cellIcon} aria-hidden>
                  <svg viewBox="0 0 12 12" width="14" height="14">
                    <path d="M6.8.8 2.4 6.3h3L4.9 11.2l4.7-6H6.5L6.8.8Z" fill="currentColor" />
                  </svg>
                </span>
                <span className={css.cellLabel}>{t('menu.speed')}</span>
                <span className={css.cellValue}>{speedLabel}</span>
                <IconChevronRightOutline14 className={css.cellChevron} />
              </button>
              <div className={css.divider} role="separator" />
              <button
                ref={itemRef()}
                type="button"
                role="menuitem"
                className={css.reset}
                disabled={!canReset || busy || fast.busy}
                onClick={() => { void resetDefaults() }}
              >
                <span>{t('action.resetDefaults')}</span>
                <IconRefreshOutline16 className={css.resetIcon} />
              </button>
            </>
          )}

          {pane === 'model' && (
            <>
              {state.status === 'loading' && (
                <div className={css.status}>{t('status.loading')}</div>
              )}
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              )}
              {state.failures.map(failure => (
                <div className={css.warning} key={failure.id}>
                  <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              ))}
              <div className={clsx(css.groups, 'scrollable')}>
                {state.groups.map((group) => {
                  const headingId = `${id}-${group.id}`
                  return (
                    <section role="group" aria-labelledby={headingId} className={css.group} key={group.id}>
                      <div className={css.groupTitle} id={headingId}>{group.name}</div>
                      {group.models.map((model) => {
                        const selected = state.current?.provider === group.id && state.current.model === model.id
                        return (
                          <button
                            ref={itemRef()}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={clsx(css.option, selected && css.selected)}
                            key={model.id}
                            title={model.name}
                            disabled={busy}
                            onClick={() => { choose({ provider: group.id, model: model.id }) }}
                          >
                            <span className={css.optionCopy}>
                              <span className={css.modelName}>{model.name}</span>
                              {model.description !== undefined && (
                                <span className={css.description}>{model.description}</span>
                              )}
                            </span>
                            <span className={css.check}>
                              {selected ? <IconCheckOutline16 /> : null}
                            </span>
                          </button>
                        )
                      })}
                    </section>
                  )
                })}
              </div>
              {state.status === 'ready' && choices.length === 0 && (
                <div className={css.empty}>{t('empty.models')}</div>
              )}
            </>
          )}

          {pane === 'effort' && (
            <>
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('action.reload')}</button>
                </div>
              )}
              {effortChoices.length === 0
                ? <div className={css.empty}>{t('empty.efforts')}</div>
                : effortChoices.map(level => (
                  <button
                    ref={itemRef()}
                    type="button"
                    role="menuitemradio"
                    aria-checked={effectiveEffort === level.effort}
                    className={clsx(css.option, effectiveEffort === level.effort && css.selected)}
                    key={level.key}
                    disabled={busy}
                    onClick={() => { chooseEffort(level.effort) }}
                  >
                    <span className={css.optionCopy}>
                      <span className={css.modelName}>{level.label}</span>
                      {level.description !== undefined && (
                        <span className={css.description}>{level.description}</span>
                      )}
                    </span>
                    <span className={css.check}>
                      {effectiveEffort === level.effort ? <IconCheckOutline16 /> : null}
                    </span>
                  </button>
                ))}
            </>
          )}

          {pane === 'speed' && (
            <>
              {fast.status === 'loading' && <div className={css.status}>{t('speed.loading')}</div>}
              {fast.status !== 'loading' && !fast.available && (
                <div className={css.empty}>
                  {fast.reason ?? t('speed.unavailableDescription')}
                </div>
              )}
              {fast.status === 'ready' && fast.available && (
                <>
                  <button
                    ref={itemRef()}
                    type="button"
                    role="menuitemradio"
                    aria-checked={!fast.enabled}
                    className={clsx(css.option, !fast.enabled && css.selected)}
                    disabled={fast.busy}
                    onClick={() => { chooseSpeed(false) }}
                  >
                    <span className={css.optionCopy}>
                      <span className={css.modelName}>{t('speed.standard')}</span>
                      <span className={css.description}>{t('speed.standardDescription')}</span>
                    </span>
                    <span className={css.check}>{!fast.enabled ? <IconCheckOutline16 /> : null}</span>
                  </button>
                  <button
                    ref={itemRef()}
                    type="button"
                    role="menuitemradio"
                    aria-checked={fast.enabled}
                    className={clsx(css.option, fast.enabled && css.selected)}
                    disabled={fast.busy}
                    onClick={() => { chooseSpeed(true) }}
                  >
                    <span className={css.optionCopy}>
                      <span className={css.modelName}>{t('speed.fast')}</span>
                      <span className={css.description}>{t('speed.fastDescription')}</span>
                    </span>
                    <span className={css.check}>{fast.enabled ? <IconCheckOutline16 /> : null}</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
