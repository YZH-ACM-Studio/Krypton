import { PermissionError, PrivilegeError } from '../error';
import { PRIV } from '../model/builtin';

export type PermissionErrorRoute = 'login' | 'domain_join' | 'error';

export function classifyPermissionErrorRoute(user: any, error: unknown): PermissionErrorRoute {
    if (user?._id === 0 && (error instanceof PermissionError || error instanceof PrivilegeError)) return 'login';
    if (!user?._dudoc?.join && !user?.hasPriv(PRIV.PRIV_MANAGE_ALL_DOMAIN) && error instanceof PermissionError) return 'domain_join';
    return 'error';
}
