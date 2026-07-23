/** ui-next currently ships one interface language regardless of legacy Hydro preference. */
export function resolveUiLocale(preference: unknown): 'zh-CN' {
  if (preference !== undefined && preference !== null && typeof preference !== 'string') {
    throw new TypeError('ui-next language preference must be a string');
  }
  return 'zh-CN';
}
