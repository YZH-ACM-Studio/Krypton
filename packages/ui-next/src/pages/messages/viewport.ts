/**
 * Shared narrow-viewport gate for the messages workbench.
 *
 * JS `matchMedia` and CSS must use the same condition: phone width
 * (`max-width: 767px`, Tailwind `max-md`) OR short height (`max-height: 540px`).
 * Dual-pane is the complement: min-width 768px AND min-height 541px.
 */

export const NARROW_QUERY = '(max-width: 767px), (max-height: 540px)';

/**
 * CSS complements live in styles.css as static variants so Tailwind can see
 * the full class names. `dual` is min-width 768px and min-height 541px.
 * `narrow` is this query. Do not build those class names with string concat.
 */
