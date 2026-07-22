export interface DomainPermissionCatalogEntry {
    desc: string;
    [key: string]: unknown;
}

const DETAIL_KEYS: Record<string, string> = {
    'Create problems': 'Create problems permission detail',
    'Create managed programming drafts': 'Create managed programming drafts permission detail',
};

export function localizeDomainPermissionCatalog<T extends DomainPermissionCatalogEntry>(
    families: Record<string, T[]>,
    translate: (key: string) => string,
) {
    return Object.fromEntries(
        Object.entries(families).map(([family, permissions]) => [
            family,
            permissions.map((permission) => ({
                ...permission,
                desc: translate(permission.desc),
                detail: DETAIL_KEYS[permission.desc] ? translate(DETAIL_KEYS[permission.desc]) : '',
            })),
        ]),
    );
}
