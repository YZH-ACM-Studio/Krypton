import fs from 'fs';
import path from 'path';
import c2k from 'koa2-connect';
import { Context } from 'hydrooj';
import { serializer } from '@hydrooj/framework';
import type { ViteDevServer } from 'vite';

type ManifestChunk = {
    file: string;
    css?: string[];
    imports?: string[];
    isEntry?: boolean;
};

const templatePath = path.join(__dirname, 'index.html');
const manifestPath = path.join(__dirname, 'public', 'next', 'manifest.json');
const templateEntryTag = '<script type="module" src="/src/main.tsx"></script>';
const devEntryTag = '<script type="module" src="/src/main.tsx"></script>';
const bootstrapPlaceholder = '__KRYPTON_BOOTSTRAP_DATA__';

function escapeForScript(data: unknown, handler?: any) {
    return JSON.stringify(data, serializer(false, handler))
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function applyReplacements(template: string, payload: {
    bootstrap: string;
    head: string;
    entry: string;
}) {
    return template
        .split(bootstrapPlaceholder).join(payload.bootstrap)
        .split('<!--KRYPTON_HEAD-->').join(payload.head)
        .split(templateEntryTag).join(payload.entry);
}

function readTemplate() {
    return fs.readFileSync(templatePath, 'utf-8');
}

function toUiTheme(theme: unknown) {
    if (typeof theme === 'string' && theme.includes('dark')) return 'dark';
    return 'light';
}

function safeUrl(context: Record<string, any>, name: string, params?: Record<string, any>) {
    try { return params ? context.url(name, params) : context.url(name); } catch { return '#'; }
}

function safeSystemGet(key: string): string {
    try {
        return (global as any).Hydro?.model?.system?.get?.(key) || '';
    } catch { return ''; }
}

function buildBootstrap(templateName: string, args: Record<string, any>, context: Record<string, any>) {
    const currentUser = context.UserContext || {};
    const domain = args.domain || context.handler?.domain || {};
    const siteName = domain?.ui?.name || domain?.name || 'Hydro';
    // Footer extras: system-wide and per-domain HTML lines. Pre-sanitised
    // by hydrooj when configured via system settings.
    const systemFooterHtml = safeSystemGet('ui-default.footer_extra_html');
    const domainFooterHtml = (domain?.ui?.footer_extra_html || '');

    return {
        appName: 'Krypton',
        siteName,
        locale: currentUser.viewLang || 'zh-CN',
        theme: toUiTheme(currentUser.theme),
        generatedAt: new Date().toISOString(),
        user: {
            id: Number(currentUser._id || 0),
            name: currentUser.uname || 'Guest',
            mail: currentUser.mail || '',
            signedIn: Number(currentUser._id || 0) > 0,
            theme: currentUser.theme || 'light',
            viewLang: currentUser.viewLang || 'zh-CN',
            unreadMessages: currentUser.unreadMsg || 0,
            rp: currentUser.rp || 0,
            bio: currentUser.bio || '',
            priv: currentUser.priv || 0,
            role: currentUser.role || 'default',
            tfa: !!currentUser.tfa,
            authn: !!currentUser.authn,
            pinnedDomains: currentUser.pinnedDomains || [],
            avatar: currentUser.avatar || '',
            avatarUrl: currentUser.avatarUrl || '',
        },
        domain: {
            id: String(domain._id || 'system'),
            name: domain?.ui?.name || domain?.name || siteName,
            bulletin: domain?.bulletin || '',
            avatar: domain?.avatar || '',
        },
        urls: {
            home: safeUrl(context, 'homepage'),
            problems: safeUrl(context, 'problem_main'),
            contests: safeUrl(context, 'contest_main'),
            homework: safeUrl(context, 'homework_main'),
            training: safeUrl(context, 'training_main'),
            ranking: safeUrl(context, 'ranking'),
            discussions: safeUrl(context, 'discussion_main'),
            domains: safeUrl(context, 'home_domain'),
            messages: safeUrl(context, 'home_messages'),
            login: safeUrl(context, 'user_login'),
            register: safeUrl(context, 'user_register'),
            logout: safeUrl(context, 'user_logout'),
            settings: safeUrl(context, 'home_settings', { category: 'preference' }).replace(/\/preference$/, ''),
            security: safeUrl(context, 'home_security'),
            files: safeUrl(context, 'home_files'),
            records: safeUrl(context, 'record_main'),
            domainDashboard: safeUrl(context, 'domain_dashboard'),
            manage: safeUrl(context, 'manage_dashboard'),
            status: safeUrl(context, 'status'),
            problemDetail: safeUrl(context, 'problem_detail', { pid: '__PID__' }),
            contestDetail: safeUrl(context, 'contest_detail', { tid: '__TID__' }),
            homeworkDetail: safeUrl(context, 'homework_detail', { tid: '__TID__' }),
            trainingDetail: safeUrl(context, 'training_detail', { tid: '__TID__' }),
            discussionDetail: safeUrl(context, 'discussion_detail', { did: '__DID__' }),
            discussionNode: safeUrl(context, 'discussion_node', { type: '__TYPE__', name: '__NAME__' }),
            userDetail: safeUrl(context, 'user_detail', { uid: '__UID__' }),
            recordDetail: safeUrl(context, 'record_detail', { rid: '__RID__' }),
        },
        udict: args.udict || {},
        footer: {
            systemHtml: systemFooterHtml,
            domainHtml: domainFooterHtml,
        },
        page: {
            templateName,
            data: args,
        },
    };
}

function assetPath(file: string) {
    return `/next/${file}`;
}

function resolveManifestAssets() {
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, ManifestChunk>;
    const entryKey = manifest['index.html']
        ? 'index.html'
        : Object.keys(manifest).find((key) => manifest[key].isEntry);
    if (!entryKey) return null;

    const css = new Set<string>();
    const preloads = new Set<string>();
    const visited = new Set<string>();

    const visit = (key: string) => {
        if (visited.has(key)) return;
        visited.add(key);
        const chunk = manifest[key];
        if (!chunk) return;
        for (const stylesheet of chunk.css || []) css.add(assetPath(stylesheet));
        for (const imported of chunk.imports || []) {
            const importedChunk = manifest[imported];
            if (importedChunk?.file) preloads.add(assetPath(importedChunk.file));
            visit(imported);
        }
    };

    visit(entryKey);
    return {
        script: assetPath(manifest[entryKey].file),
        styles: Array.from(css),
        preloads: Array.from(preloads),
    };
}

function renderMissingBuild(bootstrap: ReturnType<typeof buildBootstrap>) {
    const baseStyle = `
      <style>
        :root { color-scheme: ${bootstrap.theme}; }
        body {
          margin: 0;
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background: #020617;
          color: #e2e8f0;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        main {
          width: min(720px, 100%);
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-radius: 24px;
          padding: 28px;
          background: rgba(15, 23, 42, 0.84);
          box-shadow: 0 24px 80px rgba(2, 6, 23, 0.45);
        }
        code {
          padding: 0.15rem 0.4rem;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.18);
        }
      </style>
    `;
    return `<!doctype html><html lang="${bootstrap.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${baseStyle}</head><body><main><h1>Krypton UI build output not found</h1><p>Run <code>bun run build:ui:next</code> or <code>bun run build:ui</code>, then restart Hydro to load the React homepage.</p></main></body></html>`;
}

async function renderApp(templateName: string, args: Record<string, any>, context: Record<string, any>, vite: ViteDevServer | null) {
    context.handler?.response?.addHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    context.handler?.response?.addHeader?.('Pragma', 'no-cache');
    context.handler?.response?.addHeader?.('Expires', '0');

    const bootstrap = buildBootstrap(templateName, args, context);
    let serializedBootstrap: string;
    try {
        serializedBootstrap = escapeForScript(bootstrap, context.handler);
    } catch (e) {
        console.error('[ui-next] Failed to serialize bootstrap for', templateName, e);
        // Fallback: strip page data to avoid total failure
        bootstrap.page.data = { _serializationError: String(e) };
        serializedBootstrap = escapeForScript(bootstrap, context.handler);
    }

    if (vite) {
        const template = applyReplacements(readTemplate(), {
            bootstrap: serializedBootstrap,
            head: '',
            entry: devEntryTag,
        });
        return await vite.transformIndexHtml('/', template);
    }

    const assets = resolveManifestAssets();
    if (!assets) return renderMissingBuild(bootstrap);

    const head = [
        ...assets.preloads.map((href) => `<link rel="modulepreload" href="${href}" crossorigin>`),
        ...assets.styles.map((href) => `<link rel="stylesheet" href="${href}" crossorigin>`),
    ].join('\n');
    const entry = `<script type="module" crossorigin src="${assets.script}"></script>`;

    return applyReplacements(readTemplate(), {
        bootstrap: serializedBootstrap,
        head,
        entry,
    });
}

export async function apply(ctx: Context) {
    if (process.env.HYDRO_CLI) return;
    let vite: ViteDevServer | null = null;

    if (process.env.DEV) {
        const { createServer } = await import('vite');
        vite = await createServer({
            root: __dirname,
            configFile: path.join(__dirname, 'vite.config.ts'),
            base: '/',
            appType: 'custom',
            server: {
                middlewareMode: true,
                hmr: {
                    port: 3010,
                },
            },
        });

        const middleware = c2k(vite.middlewares);
        for (const route of ['/src/', '/@vite/', '/@react-refresh', '/node_modules/', '/@fs/', '/@id/']) {
            ctx.server.addCaptureRoute(route, middleware);
        }
    }

    ctx.server.registerRenderer('next', {
        name: 'next',
        output: 'html',
        accept: [],
        asFallback: true,
        priority: 100,
        render: async (name, args, context) => await renderApp(name, args, context, vite),
    });

    // eslint-disable-next-line consistent-return
    return async () => {
        await vite?.close().catch((e) => console.error(e));
    };
}
