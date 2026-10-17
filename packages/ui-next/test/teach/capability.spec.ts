// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

interface TeachCapabilityUser {
    hasPriv?: (privilege: unknown) => boolean;
    hasPerm?: (permission: unknown) => boolean;
}

interface TeachCapabilityInput {
    user?: TeachCapabilityUser | null;
    editSystemPriv: unknown;
    createContestPerm: unknown;
    createHomeworkPerm: unknown;
    createTrainingPerm: unknown;
    onError: (error: unknown) => void;
}

const EDIT_SYSTEM = 1;
const CREATE_CONTEST = 2n;
const CREATE_HOMEWORK = 4n;
const CREATE_TRAINING = 8n;

const repoRoot = resolvePath(import.meta.dirname, '../../../..');

function readRepo(relativePath: string): string {
    return readFileSync(resolvePath(repoRoot, relativePath), 'utf8');
}

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    if (start < 0 || end < 0) return '';
    return source.slice(start, end);
}

function hasChineseCommentImmediatelyBefore(source: string, field: string): boolean {
    const at = source.indexOf(field);
    if (at < 0) return false;
    const before = source.slice(0, at).trimEnd();
    if (before.endsWith('*/')) {
        const open = before.lastIndexOf('/**');
        if (open < 0) return false;
        return /[\u4E00-\u9FFF]/.test(before.slice(open));
    }
    const lineBreak = before.lastIndexOf('\n');
    const line = before.slice(lineBreak + 1).trim();
    return line.startsWith('//') && /[\u4E00-\u9FFF]/.test(line);
}

async function loadResolveTeachCapability(): Promise<(input: TeachCapabilityInput) => boolean> {
    const modulePath = resolvePath(import.meta.dirname, '../../teach-capabilities.ts');
    if (!existsSync(modulePath)) {
        throw new Error('resolveTeachCapability is not exported (packages/ui-next/teach-capabilities.ts is missing)');
    }
    const moduleId: string = '../../teach-capabilities.ts';
    const loaded: unknown = await import(/* @vite-ignore */ moduleId);
    if (typeof loaded !== 'object' || loaded === null || !('resolveTeachCapability' in loaded)) {
        throw new Error('resolveTeachCapability is not exported');
    }
    const exported: unknown = loaded.resolveTeachCapability;
    if (typeof exported !== 'function') {
        throw new TypeError('resolveTeachCapability is not a function');
    }
    return exported as (input: TeachCapabilityInput) => boolean;
}

function capability(
    resolveTeachCapability: (input: TeachCapabilityInput) => boolean,
    user: TeachCapabilityInput['user'],
    onError: (error: unknown) => void = () => undefined,
): boolean {
    return resolveTeachCapability({
        user,
        editSystemPriv: EDIT_SYSTEM,
        createContestPerm: CREATE_CONTEST,
        createHomeworkPerm: CREATE_HOMEWORK,
        createTrainingPerm: CREATE_TRAINING,
        onError,
    });
}

describe('teach capability resolution', () => {
    let resolveTeachCapability: (input: TeachCapabilityInput) => boolean = () => {
        throw new Error('resolveTeachCapability is not exported');
    };

    beforeAll(async () => {
        resolveTeachCapability = await loadResolveTeachCapability();
    });

    it('returns true when only homework creation is granted', () => {
        expect(capability(resolveTeachCapability, {
            hasPriv: () => false,
            hasPerm: (permission: unknown) => permission === CREATE_HOMEWORK,
        })).to.equal(true);
    });

    it('returns true when only contest creation, training creation, or system edit is granted', () => {
        expect(capability(resolveTeachCapability, {
            hasPriv: () => false,
            hasPerm: (permission: unknown) => permission === CREATE_CONTEST,
        })).to.equal(true);
        expect(capability(resolveTeachCapability, {
            hasPriv: () => false,
            hasPerm: (permission: unknown) => permission === CREATE_TRAINING,
        })).to.equal(true);
        expect(capability(resolveTeachCapability, {
            hasPriv: (privilege: unknown) => privilege === EDIT_SYSTEM,
            hasPerm: () => false,
        })).to.equal(true);
    });

    it('returns false when the user has no teach permission', () => {
        expect(capability(resolveTeachCapability, {
            hasPriv: () => false,
            hasPerm: () => false,
        })).to.equal(false);
        expect(capability(resolveTeachCapability, undefined)).to.equal(false);
        expect(capability(resolveTeachCapability, null)).to.equal(false);
    });

    it('returns false and calls onError when hasPerm throws', () => {
        const failure = new Error('permission lookup failed');
        const observed: unknown[] = [];
        expect(capability(resolveTeachCapability, {
            hasPriv: () => false,
            hasPerm: () => {
                throw failure;
            },
        }, (error) => observed.push(error))).to.equal(false);
        expect(observed.includes(failure)).to.equal(true);
    });

    it('returns false and calls onError when hasPriv throws or a permission method is missing', () => {
        const failure = new Error('privilege lookup failed');
        const observed: unknown[] = [];
        expect(capability(resolveTeachCapability, {
            hasPriv: () => {
                throw failure;
            },
            hasPerm: () => true,
        }, (error) => observed.push(error))).to.equal(false);
        expect(observed.includes(failure)).to.equal(true);

        const missingPerm: unknown[] = [];
        expect(capability(
            resolveTeachCapability,
            { hasPriv: () => false },
            (error) => missingPerm.push(error),
        )).to.equal(false);
        expect(missingPerm.length > 0).to.equal(true);

        const missingPriv: unknown[] = [];
        expect(capability(
            resolveTeachCapability,
            { hasPerm: () => true },
            (error) => missingPriv.push(error),
        )).to.equal(false);
        expect(missingPriv.length > 0).to.equal(true);
    });

    it('returns false and calls onError when system edit would pass but hasPerm is missing', () => {
        const observed: unknown[] = [];
        expect(capability(resolveTeachCapability, {
            hasPriv: () => true,
        }, (error) => observed.push(error))).to.equal(false);
        expect(observed.length > 0).to.equal(true);
    });

    it('returns true without onError when system edit is granted even if a later permission lookup throws', () => {
        const observed: unknown[] = [];
        expect(capability(resolveTeachCapability, {
            hasPriv: () => true,
            hasPerm: () => {
                throw new Error('permission lookup failed');
            },
        }, (error) => observed.push(error))).to.equal(true);
        expect(observed.length).to.equal(0);
    });

    it('returns false without onError when the user is missing', () => {
        const observed: unknown[] = [];
        const report = (error: unknown) => {
            observed.push(error);
        };
        expect(capability(resolveTeachCapability, undefined, report)).to.equal(false);
        expect(capability(resolveTeachCapability, null, report)).to.equal(false);
        expect(observed.length).to.equal(0);
    });
});

describe('teach capability bootstrap wiring', () => {
    it('puts canTeach inside the bootstrap user object', () => {
        const server = readRepo('packages/ui-next/index.ts');
        const user = sliceBetween(server, 'user: {', 'domain: {');
        expect(user.length > 0).to.equal(true);
        expect(user).to.include('canTeach,');
        expect(server).to.include('resolveTeachCapability');
        expect(server).to.include("from './teach-capabilities'");
        expect(server).to.include('createContestPerm:');
        expect(server).to.include('PERM.PERM_CREATE_CONTEST');
        expect(server).to.include('createHomeworkPerm:');
        expect(server).to.include('PERM.PERM_CREATE_HOMEWORK');
        expect(server).to.include('createTrainingPerm:');
        expect(server).to.include('PERM.PERM_CREATE_TRAINING');
    });

    it('resolves canTeach from the current handler user', () => {
        const server = readRepo('packages/ui-next/index.ts');
        const call = sliceBetween(server, 'const canTeach = resolveTeachCapability({', 'const canManageDomainPermissions');
        expect(call.length > 0).to.equal(true);
        expect(call).to.include('user: context.handler?.user');
    });

    it('declares optional canTeach on the bootstrap user with a chinese comment', () => {
        const types = readRepo('packages/ui-next/src/lib/bootstrap.tsx');
        expect(types).to.include('canTeach?: boolean');
        expect(hasChineseCommentImmediatelyBefore(types, 'canTeach?: boolean')).to.equal(true);
    });

    it('registers teach-capabilities on every prepare.js capability list', () => {
        // PLAN names the two lists in lines 135–215. prepare.js also mirrors that
        // list into packages/ui-next/tsconfig.json, same as collect-capabilities.
        const prepare = readRepo('build/prepare.js');
        const uiNext = sliceBetween(prepare, 'const UINextConfig = {', 'const CheckConfig = {');
        const check = sliceBetween(prepare, 'const CheckConfig = {', 'const UIWorkersConfig = {');
        const packageConfig = sliceBetween(prepare, 'const UINextPackageConfig = {', "tryUpdate(path.resolve(process.cwd(), 'packages/ui-next'");
        expect(uiNext.length > 0).to.equal(true);
        expect(check.length > 0).to.equal(true);
        expect(packageConfig.length > 0).to.equal(true);
        expect(uiNext).to.include('teach-capabilities');
        expect(check).to.include('teach-capabilities');
        expect(packageConfig).to.include('teach-capabilities');
        // eslint-disable-next-line no-template-curly-in-string
        expect(prepare).to.include('packages/ui-next/teach-capabilities.${ext}');
        expect(prepare).to.include("'packages/ui-next/teach-capabilities.ts'");
        expect(prepare).to.include("'teach-capabilities.ts'");
    });
});
