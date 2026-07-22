export interface DomainPermissionCatalogEntry {
    key: bigint;
    desc: string;
    [key: string]: unknown;
}

export interface LocalizedDomainPermission {
    key: string;
    name: string;
    detail: string;
    risk: 'high' | null;
    includes: Array<{ key: string; name: string }>;
}

export interface LocalizedDomainPermissionFamily {
    key: string;
    label: string;
    permissions: LocalizedDomainPermission[];
}

const DETAIL_KEYS: Record<string, string> = {
    'Create problems': 'Create problems permission detail',
    'Create managed programming drafts': 'Create managed programming drafts permission detail',
};

const HIGH_RISK_PERMISSIONS = new Set([
    'Edit domain settings',
    'Edit problems',
    'View hidden problems',
    'Read data of problem',
    'Read all record codes',
    'Rejudge problems',
    'Rejudge records',
    'Delete problem solutions',
    'Highlight discussions',
    'Pin discussions',
    'Edit discussions',
    'Lock discussions',
    'Delete discussions',
    'Delete discussion replies',
    'Edit any contests',
    'View all contests',
    'Edit any homework',
    'View all homework',
    'Edit training plans',
    'Manage all tasks in this domain',
    'Manage rankboard structure and scoring',
    'Manage student records and groups',
    'Edit any courses',
]);

const INCLUDED_PERMISSIONS: Record<string, string[]> = {
    'Create problems': ['Create managed programming drafts'],
};

function formatDetail(template: string, name: string) {
    return template.replace('{0}', name);
}

/**
 * Legacy record shape retained for server-side callers that only need
 * translated permission names. The workspace builder below is canonical for
 * the role editor and adds family, risk and inclusion metadata.
 */
export function localizeDomainPermissionCatalog<T extends DomainPermissionCatalogEntry>(
    families: Record<string, T[]>,
    translate: (key: string) => string,
) {
    return Object.fromEntries(
        Object.entries(families).map(([family, permissions]) => [
            family,
            permissions.map((permission) => {
                const name = translate(permission.desc);
                const detailKey = DETAIL_KEYS[permission.desc];
                return {
                    ...permission,
                    desc: name,
                    detail: detailKey
                        ? translate(detailKey)
                        : formatDetail(translate('Domain permission behavior detail'), name),
                };
            }),
        ]),
    );
}

export function buildLocalizedDomainPermissionFamilies<T extends DomainPermissionCatalogEntry>(
    families: Record<string, T[]>,
    translate: (key: string) => string,
): LocalizedDomainPermissionFamily[] {
    const localizedNames = new Map<string, string>();
    for (const permissions of Object.values(families)) {
        for (const permission of permissions) localizedNames.set(permission.desc, translate(permission.desc));
    }
    return Object.entries(families).map(([family, permissions]) => ({
        key: family,
        label: translate(family),
        permissions: permissions.map((permission) => {
            const name = localizedNames.get(permission.desc) || permission.desc;
            const detailKey = DETAIL_KEYS[permission.desc];
            return {
                key: permission.key.toString(),
                name,
                detail: detailKey
                    ? translate(detailKey)
                    : formatDetail(translate('Domain permission behavior detail'), name),
                risk: HIGH_RISK_PERMISSIONS.has(permission.desc) ? 'high' : null,
                includes: (INCLUDED_PERMISSIONS[permission.desc] || []).map((included) => {
                    const target = Object.values(families)
                        .flat()
                        .find((candidate) => candidate.desc === included);
                    if (!target) throw new TypeError(`Unknown included domain permission: ${included}`);
                    return { key: target.key.toString(), name: localizedNames.get(included) || included };
                }),
            };
        }),
    }));
}
