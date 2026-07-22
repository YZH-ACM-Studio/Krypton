import { ForbiddenError, UserNotFoundError } from '../error';

interface SudoAuthenticationUser {
    _id: number;
}

interface SudoAuthenticationContext<T> {
    user: T;
    impersonated: boolean;
}

interface ImpersonationActor {
    _id: number;
    hasPriv(privilege: number): boolean;
}

export function assertImpersonationActorPrivileges(actor: ImpersonationActor, requiredPrivileges: number[]) {
    if (requiredPrivileges.some((privilege) => !actor.hasPriv(privilege))) {
        throw new ForbiddenError('原管理员账号已无权继续代理操作');
    }
}

/** Resolve the account whose secret authorizes entering sudo mode. */
export async function resolveSudoAuthenticationUser<T extends SudoAuthenticationUser>(
    currentUser: T,
    sudoUid: unknown,
    loadUser: (uid: number) => Promise<T | null>,
): Promise<SudoAuthenticationContext<T>> {
    if (sudoUid === null || sudoUid === undefined) return { user: currentUser, impersonated: false };
    const actorUid = Number(sudoUid);
    if (!Number.isSafeInteger(actorUid) || actorUid <= 0) throw new ForbiddenError('代理身份记录无效');
    const actor = await loadUser(actorUid);
    if (!actor) throw new UserNotFoundError(actorUid);
    return { user: actor, impersonated: true };
}
