/**
 * MultiSelect — generic multi-select combobox.
 *
 * Features:
 *   - Sync (`options`) or async (`loadOptions`) data source
 *   - Live typeahead filter (debounced for async)
 *   - Chips inside the trigger for each selected item, with individual `×`
 *   - Drag-to-reorder chips (whole chip is draggable; `×` is its own button
 *     so removing doesn't trigger a drag)
 *   - Custom renderers for both chips and dropdown rows
 *   - Hidden form input for native form submit (CSV by default, or
 *     repeated `<input name=field>` for Hydro multi-value fields)
 *
 * Designed for the multi-language and multi-problem pickers but generic.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import { DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/cn';
import { ScrollArea } from '@/components/ui/scroll-area';
import { calculateAnchoredPopoverBox, type AnchoredPopoverBox } from '@/components/ui/tooltip-position';

export interface MultiSelectProps<T> {
  /** Sync mode: complete option list, filtered client-side. */
  options?: T[];
  /** Async mode: called with the typed query (debounced ~250ms). */
  loadOptions?: (query: string) => Promise<T[]>;

  /** Currently selected items, in user-defined order. */
  value: T[];
  /** Replaces `value` on add / remove / reorder. */
  onChange: (next: T[]) => void;

  /** Unique key for an item — used for diffing and React keys. */
  getKey: (item: T) => string;
  /** Plain text used for search-matching and the default chip / row label. */
  getLabel: (item: T) => string;
  /** Optional secondary text shown in the dropdown row. */
  getDescription?: (item: T) => ReactNode;

  /** Custom chip body (excluding the `×` button). Defaults to label. */
  renderChip?: (item: T) => ReactNode;
  /** Custom dropdown row body. Defaults to label + description. */
  renderOption?: (item: T, opts: { selected: boolean }) => ReactNode;

  placeholder?: string;
  emptyText?: string;
  maxItems?: number;
  disabled?: boolean;
  className?: string;
  /** Trigger min-height in pixels. Omitted uses `--control-lg`. */
  minHeight?: number;

  /* Form integration ───────────────────────────── */

  /** When set, a hidden form input echoes the value. */
  name?: string;
  /**
   * How the hidden input is laid out:
   *   - `csv` (default): one input with comma-joined keys.
   *   - `repeated`: one input per selected item, all with the same name.
   */
  valueFormat?: 'csv' | 'repeated';
}

function popoverStyle(box: AnchoredPopoverBox): CSSProperties {
  return {
    position: 'fixed',
    left: box.left,
    width: box.width,
    maxHeight: box.maxHeight,
    top: box.top,
    bottom: box.bottom,
    transformOrigin: box.side === 'top' ? 'bottom center' : 'top center',
  };
}

const menuSurface =
  'z-50 rounded-lg border border-line bg-surface-raised text-fg shadow-pop ' +
  'data-[state=open]:animate-[kr-pop-in_var(--dur-3)_var(--ease-out)] ' +
  'data-[state=closed]:animate-[kr-pop-out_var(--dur-2)_var(--ease-in)]';

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function MultiSelect<T>({
  options,
  loadOptions,
  value,
  onChange,
  getKey,
  getLabel,
  getDescription,
  renderChip,
  renderOption,
  placeholder = '搜索…',
  emptyText = '无匹配项',
  maxItems,
  disabled,
  className,
  minHeight,
  name,
  valueFormat = 'csv',
}: MultiSelectProps<T>) {
  const isAsync = !!loadOptions;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [asyncResults, setAsyncResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const requestSeq = useRef(0);
  const swallowOverlayClickRef = useRef(false);
  const menuOpenRef = useRef(false);
  const focusFrameRef = useRef<number | null>(null);
  const [popoverBox, setPopoverBox] = useState<AnchoredPopoverBox | null>(null);
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  const cancelScheduledInputFocus = useCallback(() => {
    if (focusFrameRef.current == null) return;
    cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = null;
  }, []);

  const openMenu = useCallback(() => {
    menuOpenRef.current = true;
    setOpen(true);
  }, []);

  const closeMenu = useCallback(() => {
    // The trigger click focuses the input on the next frame. If that frame lands
    // after an outside press, onFocus would reopen the menu.
    menuOpenRef.current = false;
    cancelScheduledInputFocus();
    setOpen(false);
  }, [cancelScheduledInputFocus]);

  const scheduleInputFocus = useCallback(() => {
    cancelScheduledInputFocus();
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      if (!menuOpenRef.current) return;
      inputRef.current?.focus();
    });
  }, [cancelScheduledInputFocus]);

  const selectedKeys = useMemo(() => new Set(value.map(getKey)), [value, getKey]);

  /* Async loader (debounced 250ms while open) */
  useEffect(() => {
    if (!isAsync || !open) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    const t = setTimeout(() => {
      loadOptions!(query)
        .then((res) => {
          if (seq !== requestSeq.current) return;
          setAsyncResults(Array.isArray(res) ? res : []);
        })
        .catch(() => {
          if (seq === requestSeq.current) setAsyncResults([]);
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(t);
    };
  }, [query, open, isAsync]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!swallowOverlayClickRef.current) return;
      swallowOverlayClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => cancelScheduledInputFocus, [cancelScheduledInputFocus]);

  /* Bubble mousedown closes the menu; only a Dialog overlay click is swallowed so the Dialog stays open. */
  useEffect(() => {
    if (!open) return;
    const isInside = (target: EventTarget | null) =>
      target instanceof Node && Boolean(triggerRef.current?.contains(target) || popoverRef.current?.contains(target));
    const isDialogOverlay = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      const dialogRoot = triggerRef.current?.closest('[data-krypton-dialog-root="true"]');
      if (!(dialogRoot instanceof HTMLElement) || !dialogRoot.contains(target)) return false;
      const panel = dialogRoot.querySelector('[role="dialog"]');
      if (panel?.contains(target)) return false;
      if (popoverRef.current?.contains(target)) return false;
      return true;
    };
    const onMouseDown = (event: MouseEvent) => {
      if (isInside(event.target)) return;
      closeMenu();
      if (isDialogOverlay(event.target)) swallowOverlayClickRef.current = true;
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, closeMenu]);

  useLayoutEffect(() => {
    if (!open) {
      setPopoverBox(null);
      setPortalEl(null);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    const dialogRoot = trigger.closest('[data-krypton-dialog-root="true"]');
    setPortalEl(dialogRoot instanceof HTMLElement ? dialogRoot : document.body);
    const update = () => {
      setPopoverBox(
        calculateAnchoredPopoverBox(trigger.getBoundingClientRect(), {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
    };
    update();
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    const observer = new ResizeObserver(update);
    observer.observe(trigger);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
      observer.disconnect();
    };
  }, [open]);

  /* Filter for sync mode */
  const visibleOptions: T[] = useMemo(() => {
    if (isAsync) return asyncResults;
    if (!options) return [];
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => getLabel(o).toLowerCase().includes(q));
  }, [isAsync, asyncResults, options, query, getLabel]);

  /* Keep highlightedIndex in range when options change */
  useEffect(() => {
    setHighlightedIndex((idx) => Math.min(idx, Math.max(0, visibleOptions.length - 1)));
  }, [visibleOptions.length]);

  const atMax = maxItems != null && value.length >= maxItems;

  const toggleItem = useCallback(
    (item: T) => {
      if (disabled) return;
      const k = getKey(item);
      if (selectedKeys.has(k)) {
        onChange(value.filter((v) => getKey(v) !== k));
      } else {
        if (atMax) return;
        onChange([...value, item]);
      }
      setQuery('');
      setHighlightedIndex(0);
      scheduleInputFocus();
    },
    [disabled, getKey, selectedKeys, value, onChange, atMax, scheduleInputFocus],
  );

  const removeItem = useCallback(
    (key: string) => {
      if (disabled) return;
      onChange(value.filter((v) => getKey(v) !== key));
    },
    [disabled, value, getKey, onChange],
  );

  /* Drag-to-reorder chips */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = value.findIndex((v) => getKey(v) === String(active.id));
    const newIndex = value.findIndex((v) => getKey(v) === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(value, oldIndex, newIndex));
  };

  /* Keyboard nav inside input */
  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openMenu();
      setHighlightedIndex((i) => Math.min(visibleOptions.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      if (!open) {
        openMenu();
        return;
      }
      const item = visibleOptions[highlightedIndex];
      if (item) {
        e.preventDefault();
        toggleItem(item);
      }
    } else if (e.key === 'Backspace' && !query && value.length) {
      // Quick-remove last chip
      e.preventDefault();
      removeItem(getKey(value[value.length - 1]));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    }
  };

  /* ---------------- render ---------------- */

  return (
    <div className={cn('relative', className)}>
      {/* Trigger */}
      <div
        ref={triggerRef}
        className={cn(
          'flex flex-wrap items-center gap-1 rounded-md border border-line-strong bg-surface px-1.5 py-1 text-sm text-fg shadow-xs',
          'transition-[border-color,box-shadow] duration-(--dur-1) ease-(--ease-standard)',
          !disabled && 'hover:border-fg-disabled focus-within:border-brand focus-within:outline-none focus-within:ring-3 focus-within:ring-ring/40',
          open && !disabled && 'border-brand ring-3 ring-ring/40',
          minHeight == null && 'min-h-(--control-lg)',
          disabled && 'cursor-not-allowed bg-surface-sunken text-fg-disabled',
        )}
        style={minHeight == null ? undefined : { minHeight }}
        onClick={() => {
          if (!disabled) {
            openMenu();
            scheduleInputFocus();
          }
        }}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={value.map(getKey)} strategy={horizontalListSortingStrategy}>
            {value.map((item) => (
              <Chip
                key={getKey(item)}
                id={getKey(item)}
                label={renderChip ? renderChip(item) : getLabel(item)}
                disabled={disabled}
                onRemove={() => removeItem(getKey(item))}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* Inline search input */}
        {!atMax ? (
          <div className="flex flex-1 min-w-[80px] items-center gap-1 px-1">
            <Search className={cn('size-4 shrink-0', disabled ? 'text-fg-disabled' : 'text-fg-subtle')} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                openMenu();
              }}
              onFocus={() => openMenu()}
              onKeyDown={onInputKeyDown}
              onMouseDown={(e) => e.stopPropagation()}
              placeholder={value.length === 0 ? placeholder : ''}
              className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:text-fg-disabled"
              disabled={disabled}
            />
          </div>
        ) : (
          <span className={cn('ml-auto text-2xs', disabled ? 'text-fg-disabled' : 'text-fg-subtle')}>已达上限 {maxItems}</span>
        )}

        <ChevronDown
          className={cn(
            'size-4 shrink-0 transition-transform duration-(--dur-2) ease-(--ease-out)',
            disabled ? 'text-fg-disabled' : 'text-fg-subtle',
            open && 'rotate-180',
          )}
        />
      </div>

      {/* Hidden form input(s) */}
      {name ? (
        valueFormat === 'repeated' ? (
          <>
            {value.map((item) => (
              <input key={getKey(item)} type="hidden" name={name} value={getKey(item)} />
            ))}
          </>
        ) : (
          <input type="hidden" name={name} value={value.map(getKey).join(',')} />
        )
      ) : null}

      {open && popoverBox && portalEl
        ? createPortal(
            <ScrollArea
              ref={popoverRef}
              data-state="open"
              className={menuSurface}
              style={popoverStyle(popoverBox)}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') {
                  e.preventDefault();
                  closeMenu();
                }
              }}
            >
              {/* Pad the scroll content, not the max-height root, so the last row can scroll into view. */}
              <div className="p-1">
              {loading ? (
                <p className="flex items-center justify-center gap-2 py-3 text-xs text-fg-subtle">
                  <Loader2 className="size-3 animate-spin" /> 搜索中…
                </p>
              ) : visibleOptions.length === 0 ? (
                <p className="py-3 text-center text-xs text-fg-subtle">{emptyText}</p>
              ) : (
                visibleOptions.map((item, i) => {
                  const k = getKey(item);
                  const selected = selectedKeys.has(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      className={cn(
                        'flex min-h-(--control-md) w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-fg',
                        'transition-colors duration-(--dur-1) ease-(--ease-standard)',
                        highlightedIndex === i ? 'bg-surface-hover' : 'hover:bg-surface-hover',
                      )}
                      onMouseEnter={() => setHighlightedIndex(i)}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleItem(item);
                      }}
                    >
                      <span
                        className={cn(
                          'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-sm border',
                          selected ? 'border-brand bg-brand text-on-brand' : 'border-line-strong bg-surface',
                        )}
                      >
                        {selected ? <Check className="size-3" /> : null}
                      </span>
                      <span className="flex-1 min-w-0">
                        {renderOption ? (
                          renderOption(item, { selected })
                        ) : (
                          <>
                            <span className="block truncate">{getLabel(item)}</span>
                            {getDescription ? <span className="block truncate text-2xs text-fg-subtle">{getDescription(item)}</span> : null}
                          </>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
              </div>
            </ScrollArea>,
            portalEl,
          )
        : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Chip (sortable)                                                    */
/* ------------------------------------------------------------------ */

function Chip({ id, label, onRemove, disabled = false }: { id: string; label: ReactNode; onRemove: () => void; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <span
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-sm bg-surface-active px-1.5 py-0.5 text-xs',
        disabled ? 'text-fg-disabled' : 'cursor-grab text-fg active:cursor-grabbing',
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="min-w-0 truncate">{label}</span>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className={cn(
          'ml-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm',
          disabled ? 'text-fg-disabled' : 'text-fg-subtle hover:bg-surface-hover hover:text-fg',
        )}
        disabled={disabled}
        aria-label="移除"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}
