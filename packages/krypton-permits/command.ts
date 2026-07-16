import type { CAC } from 'cac';
import { registerCommands } from './src/cli';

/** Exposes guarded repair commands through Hydro's addon command discovery. */
export function register(cli: CAC): void {
    registerCommands({ cli });
}
