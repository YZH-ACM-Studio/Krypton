interface ProblemTestcaseConfig {
  count?: unknown;
  mode?: unknown;
  type?: unknown;
}

export function shouldShowNoTestdataWarning(pdoc: { config?: unknown; reference?: unknown }, examModeEnabled = false): boolean {
  if (examModeEnabled || pdoc.reference || !pdoc.config || typeof pdoc.config !== 'object' || Array.isArray(pdoc.config)) return false;
  const config = pdoc.config as ProblemTestcaseConfig;
  if (config.type === 'remote_judge') return false;
  if (config.type === 'program_fill' && config.mode === 'text') return false;
  return !(Number(config.count) > 0);
}
