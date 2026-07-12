import { Filter, ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { NotAssignedError } from '../error';
import { Tdoc } from '../interface';
import { PERM, PRIV } from './builtin';

const logger = new Logger('homework-access');

export function canBypassHomeworkAccess(user: any, tdoc?: Tdoc): boolean {
    return !!(tdoc && user.own(tdoc))
        || user.hasPerm(PERM.PERM_VIEW_HIDDEN_HOMEWORK)
        || user.hasPerm(PERM.PERM_EDIT_HOMEWORK)
        || user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}

export async function getHomeworkUserGroupIds(domainId: string, uid: number): Promise<Set<string>> {
    const userbind = (global as any).Hydro?.model?.userbind;
    if (typeof userbind?.findStudentByUserId !== 'function') {
        throw new TypeError('userbind.findStudentByUserId is unavailable');
    }
    try {
        const student = await userbind.findStudentByUserId(domainId, uid);
        return new Set((student?.groupIds || []).map((groupId: ObjectId) => String(groupId)));
    } catch (error) {
        logger.error('Homework user-group lookup failed domain=%s uid=%d error=%o', domainId, uid, error);
        throw error;
    }
}

export function participantGroupObjectIds(groupIds: Set<string>): ObjectId[] {
    return Array.from(groupIds).map((groupId) => new ObjectId(groupId));
}

export function homeworkParticipantScopeAllows(tdoc: Tdoc, groupIds: Set<string>): boolean {
    if (!tdoc.participantScopeMode || tdoc.participantScopeMode === 'none') return true;
    if (tdoc.participantScopeMode !== 'groups') return false;
    return (tdoc.participantGroupIds || []).some((groupId) => groupIds.has(String(groupId)));
}

export async function assertHomeworkAccess(domainId: string, tdoc: Tdoc, user: any): Promise<void> {
    if (canBypassHomeworkAccess(user, tdoc)) return;
    if (tdoc.assign?.length
        && !new Set(tdoc.assign).intersection(new Set(user.group || [])).size) {
        throw new NotAssignedError('homework', tdoc.docId);
    }
    if (tdoc.participantScopeMode && tdoc.participantScopeMode !== 'none') {
        const groupIds = await getHomeworkUserGroupIds(domainId, user._id);
        if (!homeworkParticipantScopeAllows(tdoc, groupIds)) {
            throw new NotAssignedError('homework', tdoc.docId);
        }
    }
}

export function buildHomeworkListAccessFilter(
    uid: number,
    legacyGroups: string[],
    participantGroupIds: ObjectId[],
): Filter<Tdoc> {
    return {
        $or: [
            { maintainer: uid },
            { owner: uid },
            {
                $and: [
                    { $or: [{ assign: { $in: legacyGroups } }, { assign: { $size: 0 } }] },
                    {
                        $or: [
                            { participantScopeMode: { $exists: false } },
                            { participantScopeMode: 'none' },
                            {
                                participantScopeMode: 'groups',
                                participantGroupIds: { $in: participantGroupIds },
                            },
                        ],
                    },
                ],
            },
        ],
    };
}
