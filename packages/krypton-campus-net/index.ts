/**
 * @hydrooj/krypton-campus-net — campus-net EPortal autodial + Hydro root notify.
 *
 * Loaded as a built-in addon. See packages/hydrooj/src/loader.ts:BUILTIN_ADDONS.
 * apply() registers CLI only; no HTTP routes.
 *
 * `hydrooj campus-net:tick` is discovered from addon command.ts via getAddons()
 * (addon.json). Builtin addons are not in addon.json, so systemd uses
 * `hydrooj cli campus-net:tick`, which loadCli() + apply() dispatch.
 */
import type { Context } from 'hydrooj';
import { dispatchHydroCliTick, registerCommands } from './src/cli';

export {
    EPORTAL_BASE_URL,
    EPORTAL_LOGIN_URL,
    EPortalLoginError,
    login,
    parseEportalLoginBody,
} from './src/eportal';
export { INTERNET_PROBE_URL, probeInternet } from './src/probe';

export async function apply(ctx: Context) {
    registerCommands(ctx);
    await dispatchHydroCliTick();
}
