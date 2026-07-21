import user from '../model/user';

export interface PublicTeamUser {
    _id: number;
    uname: string;
    displayName: string;
    studentId?: string;
    realName?: string;
}

function userbindBridge() {
    const bridge = global.Hydro?.model?.userbind;
    if (!bridge?.findStudentsByUserIds || !bridge.searchBoundStudents) {
        throw new Error('userbind identity search bridge is required for team user search');
    }
    return bridge;
}

export async function getPublicTeamUsers(domainId: string, userIds: number[]): Promise<Record<string, PublicTeamUser>> {
    const uids = Array.from(new Set(userIds.filter((uid) => Number.isSafeInteger(uid) && uid > 1)));
    if (!uids.length) return {};
    const bridge = userbindBridge();
    const [rawUsers, students] = await Promise.all([
        user.getListForRender(domainId, uids, ['displayName']),
        bridge.findStudentsByUserIds(domainId, uids),
    ]);
    return Object.fromEntries(
        uids.map((uid) => {
            const student = students[String(uid)];
            return [
                String(uid),
                {
                    _id: uid,
                    uname: rawUsers[uid]?.uname || `UID ${uid}`,
                    displayName: rawUsers[uid]?.displayName || rawUsers[uid]?.uname || `UID ${uid}`,
                    ...(student?.studentId ? { studentId: student.studentId } : {}),
                    ...(student?.realName ? { realName: student.realName } : {}),
                } satisfies PublicTeamUser,
            ];
        }),
    );
}

export async function searchPublicTeamUsers(domainId: string, query: string, limit = 20): Promise<PublicTeamUser[]> {
    const q = query.trim();
    if (!q) return [];
    const bridge = userbindBridge();
    const exactUid = /^\d+$/.test(q) ? Number(q) : 0;
    const [exactUser, prefixUsers, studentMatches] = await Promise.all([
        Number.isSafeInteger(exactUid) && exactUid > 1 ? user.getById(domainId, exactUid) : Promise.resolve(null),
        user.getPrefixList(domainId, q, limit),
        bridge.searchBoundStudents(domainId, q, limit),
    ]);

    const uids: number[] = [];
    const seen = new Set<number>();
    const add = (uid: number) => {
        if (!Number.isSafeInteger(uid) || uid <= 1 || seen.has(uid) || uids.length >= limit) return;
        seen.add(uid);
        uids.push(uid);
    };
    if (exactUser) add(exactUser._id);
    prefixUsers.forEach((candidate) => add(candidate._id));
    studentMatches.forEach((student) => add(student.boundUserId));

    const users = await getPublicTeamUsers(domainId, uids);
    return uids.flatMap((uid) => (users[String(uid)] ? [users[String(uid)]] : []));
}
