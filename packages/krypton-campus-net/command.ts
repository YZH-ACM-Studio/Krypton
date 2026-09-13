import type { CAC } from 'cac';
import { registerCommands } from './src/cli';

/** Exposes campus-net:tick through Hydro's getAddons() command.ts discovery. */
export function register(cli: CAC): void {
    registerCommands({ cli });
}
