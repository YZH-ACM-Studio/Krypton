const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const prefix = '/next/releases/';
const assetDirectories = new Set(['assets', 'cmaps', 'standard_fonts', 'wasm']);
const answerTemplates = new Set([
    'set_workspace.html', 'contest_workspace.html', 'exam_paper.html', 'exam_contest.html',
    'problem_detail.html', 'problem_submit.html',
]);
const releaseHeader = 'X-Krypton-UI-Release';
const artifactHeader = 'X-Krypton-UI-Artifact';

function isCommit(value) {
    return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function requireCommit(value) {
    if (!isCommit(value)) throw new Error('Expected a full Git commit SHA');
    return value;
}

function assetPath(file) {
    if (typeof file !== 'string') return false;
    const segments = file.split('/');
    return segments.length >= 2 && assetDirectories.has(segments[0])
        && segments.every((segment) => /^[a-zA-Z0-9_@+-][a-zA-Z0-9._@+-]*$/.test(segment));
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function releaseDirectory(root, commit) {
    return path.join(root, 'releases', requireCommit(commit));
}

function readState(root) {
    const state = readJson(path.join(root, 'active.json'));
    if (state?.schema !== 1 || !isCommit(state.current) || !isCommit(state.backendCommit)
        || (state.previous !== null && !isCommit(state.previous))
        || !Number.isFinite(Date.parse(state.switchedAt))
        || (state.verifiedAt !== null && !Number.isFinite(Date.parse(state.verifiedAt)))) {
        throw new Error('Invalid UINext release state');
    }
    return state;
}

function readRelease(directory) {
    const meta = readJson(path.join(directory, 'release.json'));
    if (meta?.schema !== 1 || !isCommit(meta.commit) || !isCommit(meta.backendCommit)
        || typeof meta.artifactSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(meta.artifactSha256)) {
        throw new Error('Invalid UINext artifact metadata');
    }
    return meta;
}

function manifestEntry(manifest) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error('Invalid UINext manifest');
    }
    const entry = manifest['index.html'];
    if (!entry?.isEntry || !assetPath(entry.file) || !/\.m?js$/.test(entry.file)) {
        throw new Error('UINext manifest has no valid index entry');
    }
    return entry.file;
}

// Only build output is public, including the un-hashed PDF support files.
function fileHashes(directory) {
    const files = new Map();
    function scan(relative) {
        const folder = path.join(directory, relative);
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const file = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory() && (assetDirectories.has(file) || assetPath(file))) {
                scan(file);
            } else if (entry.isFile() && (assetPath(file) || file === 'manifest.json' || file === 'index.html')) {
                const contents = fs.readFileSync(path.join(directory, file));
                files.set(file, crypto.createHash('sha256').update(contents).digest('hex'));
            } else if (file !== 'release.json' || !entry.isFile()) {
                throw new Error(`Unexpected entry in UINext artifact: ${file}`);
            }
        }
    }
    scan('');
    return files;
}

function verifyArtifact(directory, meta) {
    const files = fileHashes(directory);
    const manifest = readJson(path.join(directory, 'manifest.json'));
    const entry = manifestEntry(manifest);
    for (const chunk of Object.values(manifest)) {
        if (!assetPath(chunk?.file) || !files.has(chunk.file)) throw new Error('Missing UINext manifest asset');
        for (const field of ['css', 'assets']) {
            if (chunk[field] === undefined) continue;
            if (!Array.isArray(chunk[field]) || chunk[field].some((file) => !assetPath(file) || !files.has(file))) {
                throw new Error(`Invalid UINext manifest ${field}`);
            }
        }
        for (const field of ['imports', 'dynamicImports']) {
            if (chunk[field] === undefined) continue;
            if (!Array.isArray(chunk[field]) || chunk[field].some((key) => typeof key !== 'string' || !Object.hasOwn(manifest, key))) {
                throw new Error(`Invalid UINext manifest ${field}`);
            }
        }
    }
    for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
        if (![...files.keys()].some((file) => file.startsWith(`${folder}/`))) {
            throw new Error(`Missing PDF assets: ${folder}`);
        }
    }
    const index = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
    if (!index.includes(`src="${prefix}${meta.commit}/${entry}"`)) {
        throw new Error('UINext build has the wrong release base');
    }
    const artifactSha256 = crypto.createHash('sha256').update(JSON.stringify([...files].sort())).digest('hex');
    if (meta.artifactSha256 !== undefined && meta.artifactSha256 !== artifactSha256) {
        throw new Error('UINext artifact checksum mismatch');
    }
    return { entry, artifactSha256 };
}

function answerScope(template, args, handler, backendCommit) {
    const session = handler?.session?._id;
    const uid = handler?.user?._id;
    const workspace = args.workspace;
    if (!answerTemplates.has(template) || typeof session !== 'string' || !(uid > 0)
        || args.previewMode || args.paperPreview || workspace?.mode === 'preview') return null;
    const tid = String(workspace?.tid ?? args.tdoc?.docId ?? args.examMode?.tid ?? '');
    if (!/^[0-9a-f]{24}$/.test(tid)) return null;
    const domain = args.tdoc?.domainId ?? handler.domain?._id ?? 'system';
    const hash = crypto.createHash('sha256').update(JSON.stringify([backendCommit, session, uid, domain, tid])).digest('hex');
    const now = Date.now();
    const endAt = Date.parse(workspace?.window?.endAt ?? args.tdoc?.endAt);
    const active = workspace ? workspace.phase === 'answering' : Date.parse(args.tdoc?.beginAt) <= now;
    const expires = active && endAt > now ? new Date(endAt) : null;
    return { name: `krypton-ui-${hash.slice(0, 24)}`, expires };
}

function selectRelease(root, template, args, handler) {
    const state = readState(root);
    const scope = answerScope(template, args, handler, state.backendCommit);
    const cookies = scope ? handler.context.cookies : null;
    const pin = scope && cookies.get(scope.name, { signed: true });
    // The HTTP probe can see a candidate as soon as the selector changes. New
    // answer pages stay on the last verified version until that probe passes.
    const defaultCommit = scope && !state.verifiedAt && state.previous ? state.previous : state.current;
    const commit = requireCommit(pin ?? defaultCommit);
    const directory = releaseDirectory(root, commit);
    const meta = readRelease(directory);
    if (meta.commit !== commit || meta.backendCommit !== state.backendCommit) {
        throw new Error(`Incompatible UINext release: ${commit}`);
    }
    const manifest = readJson(path.join(directory, 'manifest.json'));
    manifestEntry(manifest);
    if (!pin && scope?.expires) {
        cookies.set(scope.name, commit, { signed: true, httpOnly: true, sameSite: 'lax', path: '/', expires: scope.expires });
    }
    return { base: `${prefix}${commit}/`, commit, manifest, artifactSha256: meta.artifactSha256 };
}

function serveRelease(root) {
    return async (context) => {
        if (context.method !== 'GET' && context.method !== 'HEAD') {
            context.set('Allow', 'GET, HEAD');
            context.status = 405;
            return;
        }
        const [commit, ...segments] = context.path.slice(prefix.length).split('/');
        const file = segments.join('/');
        if (!context.path.startsWith(prefix) || !isCommit(commit) || !assetPath(file)) {
            context.status = 404;
            return;
        }
        const location = path.join(releaseDirectory(root, commit), file);
        let info;
        try {
            info = await fs.promises.lstat(location);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            context.status = 404;
            return;
        }
        if (!info.isFile()) {
            context.status = 404;
            return;
        }
        context.type = path.extname(file);
        if (!context.type) context.type = 'application/octet-stream';
        context.set('Cache-Control', 'public, max-age=31536000, immutable');
        context.set(releaseHeader, commit);
        context.length = info.size;
        if (context.method === 'GET') context.body = fs.createReadStream(location);
        context.status = 200;
    };
}

module.exports = {
    artifactHeader, manifestEntry, prefix, readRelease, readState, releaseDirectory, releaseHeader,
    requireCommit, selectRelease, serveRelease, verifyArtifact,
};
