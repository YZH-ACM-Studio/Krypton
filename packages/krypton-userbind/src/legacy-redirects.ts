/**
 * Legacy CAUCOJUserBind routes that we redirect or 410-Gone.
 *
 * Two policies, switchable via system setting `userbind.legacyRoutePolicy`:
 *   - 'redirect' (default): 302 to the new equivalent under /admin/userbind or /user/bind
 *   - 'gone'              : 410 with a brief message
 *
 * Registered in apply() through `applyLegacyRedirects(ctx)`. Removed after the
 * migration deprecation window (e.g. one semester).
 */
import { Context, Handler, param, Types, system } from 'hydrooj';

const REDIRECT_MAP: Record<string, string | ((args: any) => string)> = {
    // Old admin routes
    '/user-bind/manage': '/admin/userbind/schools',
    '/user-bind/import': '/admin/userbind/students/import',
    '/user-bind/user-manage': '/admin/userbind/students',
    '/school-group/manage': '/admin/userbind/schools',
    '/school-group/create': '/admin/userbind/schools',
    '/user-group/manage': '/admin/userbind/groups',
    '/user-group/create': '/admin/userbind/groups',
    '/binding-request/manage': '/admin/userbind/requests',
    '/management': '/admin/userbind',
    '/school-group-bypass/manage': '/admin/userbind/schools',

    // Old student routes
    '/binding-request': '/user/bind',
    '/binding-notice': '/user/bind',
    '/user-bind': '/user/bind',
    '/user-bind/check': '/user/bind',
    '/nickname': '/user',
};

function policy(): 'redirect' | 'gone' {
    return system.get('userbind.legacyRoutePolicy') === 'gone' ? 'gone' : 'redirect';
}

class LegacyStaticRedirectHandler extends Handler {
    noCheckPermView = true;
    async get() {
        const path = this.request.path;
        const target = REDIRECT_MAP[path];
        if (!target) {
            this.response.status = 404;
            return;
        }
        if (policy() === 'gone') {
            this.response.status = 410;
            this.response.body = {
                message: `This route has moved to ${target}. The legacy plugin is no longer active.`,
            };
            return;
        }
        const resolved = typeof target === 'function' ? target(this.args) : target;
        this.response.redirect = resolved;
    }
}

/** /bind/:code in the legacy plugin maps to /bind/:token in the new one (same URL shape). */
class LegacyBindTokenRedirectHandler extends Handler {
    noCheckPermView = true;

    @param('code', Types.String)
    async get({ }, code: string) {
        if (policy() === 'gone') {
            this.response.status = 410;
            this.response.body = { message: 'This bind link was issued under the old plugin and is no longer valid. Ask the admin to re-issue.' };
            return;
        }
        this.response.redirect = `/bind/${code}`;
    }

    @param('code', Types.String)
    async post({ }, code: string) {
        this.response.redirect = `/bind/${code}`;
    }
}

/** /user-bind/delete/:code → admin token revocation. */
class LegacyTokenDeleteHandler extends Handler {
    noCheckPermView = true;
    async get() {
        if (policy() === 'gone') {
            this.response.status = 410;
            return;
        }
        this.response.redirect = '/admin/userbind/tokens';
    }
}

export function applyLegacyRedirects(ctx: Context): void {
    // Register one route per legacy path. They all share the same handler.
    for (const path of Object.keys(REDIRECT_MAP)) {
        const routeName = `legacy_userbind_${path.replace(/[^a-z0-9]/gi, '_')}`;
        ctx.Route(routeName, path, LegacyStaticRedirectHandler);
    }
    // Old invite-link routes had a :code parameter.
    ctx.Route('legacy_userbind_bind_code', '/user-bind/:code', LegacyBindTokenRedirectHandler);
    ctx.Route('legacy_userbind_delete_code', '/user-bind/delete/:code', LegacyTokenDeleteHandler);
}
