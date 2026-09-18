import type { Filter } from 'mongodb';
import type { Tdoc } from '../interface';

/** Student list/home/problem-bank filter. Missing `hidden` is listed. */
export function listAccessQuery(uid: number, groups: string[], canBrowseRestricted: boolean): Filter<Tdoc> {
    if (canBrowseRestricted) return {};
    return {
        $or: [
            { owner: uid },
            { maintainer: uid },
            {
                hidden: { $ne: true },
                $or: [{ assign: { $in: groups } }, { assign: { $size: 0 } }],
            },
        ],
    };
}

export function isListVisibleToUser(
    tdoc: Pick<Tdoc, 'owner' | 'maintainer' | 'assign' | 'hidden'>,
    uid: number,
    groups: readonly string[],
    canBrowseRestricted: boolean,
): boolean {
    if (canBrowseRestricted) return true;
    if (tdoc.owner === uid) return true;
    if ((tdoc.maintainer || []).includes(uid)) return true;
    if (tdoc.hidden === true) return false;
    if (!tdoc.assign?.length) return true;
    const groupSet = new Set(groups);
    return tdoc.assign.some((name) => groupSet.has(name));
}
