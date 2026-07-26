export function shouldLoadHydroRuntime(args: readonly unknown[], options: Record<string, unknown>): boolean {
    if (args[0] === 'cli') return true;
    return !args[0] && options.help !== true && options.h !== true;
}
