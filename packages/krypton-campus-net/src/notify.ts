/**
 * Campus-net Hydro inbox notify (PLAN P4.1 / Grill G4).
 *
 * Recipient is Hydro uname `root` (real admin). Never fall back to uid 1.
 * Callers must only invoke this on 通→断, 断→通, or a new dial-fail.
 */
import { Logger } from '@hydrooj/utils';
import { MessageModel, UserModel } from 'hydrooj';

const logger = new Logger('campus-net.notify');

export const CAMPUS_NET_ROOT_UNAME = 'root';
export const CAMPUS_NET_ROOT_DOMAIN_ID = 'system';
/** Hydro system/guest sender. Not the recipient. */
export const CAMPUS_NET_SYSTEM_SENDER_UID = 1;

export type CampusNetNotifyEvent = 'up->down' | 'down->up' | 'dial-fail';
export type CampusNetObservedState = 'online' | 'offline' | 'dial_failed';

export type CampusNetNotifyPayload =
    | { event: 'up->down'; probeDetail: string }
    | { event: 'down->up'; probeDetail: string }
    | { event: 'dial-fail'; probeDetail: string; dialDetail: string };

const OBSERVED_STATES = new Set<string>(['online', 'offline', 'dial_failed']);

/** True only for 通→断, 断→通, or a new dial-fail. Same-state ticks must not notify. */
export function shouldNotifyTransition(previous: string | null, next: string): boolean {
    if (!OBSERVED_STATES.has(next)) {
        throw new Error(`unknown campus-net state: ${next}`);
    }
    if (previous !== null && !OBSERVED_STATES.has(previous)) {
        throw new Error(`unknown campus-net state: ${previous}`);
    }
    if (previous === next) return false;
    if (next === 'dial_failed') return true;
    if (next === 'online') return previous === 'offline' || previous === 'dial_failed';
    if (next === 'offline') return previous === 'online';
    throw new Error(`unknown campus-net state: ${next}`);
}

export interface CampusNetNotifyRecipient {
    _id: number;
    uname: string;
}

export interface CampusNetNotifyDependencies {
    getByUname(domainId: string, uname: string): Promise<CampusNetNotifyRecipient | null>;
    send(from: number, to: number, content: string, flag: number): Promise<unknown>;
    flagUnread: number;
}

const defaultDependencies: CampusNetNotifyDependencies = {
    getByUname: (domainId, uname) => UserModel.getByUname(domainId, uname),
    send: (from, to, content, flag) => MessageModel.send(from, to, content, flag),
    flagUnread: MessageModel.FLAG_UNREAD,
};

export function buildNotifyContent(payload: CampusNetNotifyPayload): string {
    const probe = oneLine(payload.probeDetail);
    if (payload.event === 'up->down') {
        return `[校园网] 外网探测失败（通 → 断）。探测：${probe}`;
    }
    if (payload.event === 'down->up') {
        return `[校园网] 外网已恢复（断 → 通）。探测：${probe}`;
    }
    if (payload.event === 'dial-fail') {
        return `[校园网] 探测失败且拨号失败。探测：${probe}；拨号：${oneLine(payload.dialDetail)}`;
    }
    throw new Error(`unknown campus-net notify event: ${String((payload as { event: unknown }).event)}`);
}

export async function resolveRootUid(deps: CampusNetNotifyDependencies = defaultDependencies): Promise<number> {
    const user = await deps.getByUname(CAMPUS_NET_ROOT_DOMAIN_ID, CAMPUS_NET_ROOT_UNAME);
    if (!user) {
        throw new Error('Hydro user uname "root" not found; campus-net will not send to uid 1');
    }
    if (!Number.isSafeInteger(user._id) || user._id <= CAMPUS_NET_SYSTEM_SENDER_UID) {
        throw new Error(
            `Hydro user uname "root" resolved to uid ${String(user._id)} (system/guest); expected a real admin account`,
        );
    }
    if (user.uname.trim().toLowerCase() !== CAMPUS_NET_ROOT_UNAME) {
        throw new Error(`Hydro user uname lookup for "root" returned uname ${JSON.stringify(user.uname)}`);
    }
    return user._id;
}

export async function notifyRoot(
    payload: CampusNetNotifyPayload,
    deps: CampusNetNotifyDependencies = defaultDependencies,
): Promise<void> {
    const uid = await resolveRootUid(deps);
    const content = buildNotifyContent(payload);
    await deps.send(CAMPUS_NET_SYSTEM_SENDER_UID, uid, content, deps.flagUnread);
    logger.info('notified uid=%d event=%s', uid, payload.event);
}

function oneLine(value: string): string {
    return value.replace(/\s+/g, ' ').trim().slice(0, 200) || 'unknown';
}
