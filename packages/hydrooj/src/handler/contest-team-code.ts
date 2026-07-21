import { Logger } from '@hydrooj/utils';
import { ObjectId } from 'mongodb';
import { Context } from '../context';
import { ContestNotFoundError, NotFoundError, PermissionError } from '../error';
import { PERM, PRIV } from '../model/builtin';
import * as contest from '../model/contest';
import * as contestTeam from '../model/contest-team';
import * as contestTeamCode from '../model/contest-team-code';
import * as oplog from '../model/oplog';
import user from '../model/user';
import bus from '../service/bus';
import { getTeamCodePresenceOnVigil } from '../service/vigil-bridge';
import { Handler, param, Types } from '../service/server';

const logger = new Logger('contest-team-code');
const TeamCodeSource = [
    (value: unknown) => String(value ?? ''),
    (value: unknown) => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= contestTeamCode.MAX_TEAM_CODE_BYTES,
] as const;

function publicUser(uid: number, users: Record<number, any>) {
    return {
        uid,
        uname: users[uid]?.uname || `UID ${uid}`,
        displayName: users[uid]?.displayName || users[uid]?.uname || `UID ${uid}`,
    };
}

function publicSnapshot(snapshot: contestTeamCode.TeamCodeSnapshotDoc, users: Record<number, any>, includeCode = false) {
    return {
        snapshotId: snapshot._id.toHexString(),
        teamId: snapshot.teamId.toHexString(),
        target: publicUser(snapshot.targetUid, users),
        sender: publicUser(snapshot.senderUid, users),
        problemId: snapshot.problemId,
        pid: snapshot.pid,
        title: snapshot.title,
        language: snapshot.language,
        clientVersion: snapshot.clientVersion,
        sequence: snapshot.sequence,
        createdAt: snapshot.createdAt,
        openedAt: snapshot.openedAt || null,
        state: contestTeamCode.snapshotState(snapshot),
        ...(includeCode ? { code: snapshot.code } : {}),
    };
}

function rejectionReason(error: any): string {
    return String(error?.params?.[0] || error?.code || error?.name || 'Error');
}

export class ContestTeamCodeHandler extends Handler {
    tdoc: any;
    team: contestTeam.ContestTeamDoc | null = null;
    canManage = false;
    domainId = '';

    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        this.domainId = String(this.domain?._id);
        this.tdoc = await contest.get(this.domainId, tid);
        if (!this.tdoc || contest.getParticipationMode(this.tdoc) !== 'team' || this.tdoc.rule !== 'acm') {
            throw new ContestNotFoundError(this.domainId, tid);
        }
        this.canManage = contestTeam.canManageContestTeams(this.user, this.tdoc);
        this.team = await contestTeam.getTeamByMember(this.domainId, tid, this.user._id);
        if (this.canManage) return;
        this.checkPerm(PERM.PERM_VIEW_CONTEST);
        this.checkPerm(PERM.PERM_ATTEND_CONTEST);
        await contestTeam.assertContestTeamEligibility(this.domainId, this.tdoc, this.user._id);
        if (!this.team) throw new PermissionError(PERM.PERM_ATTEND_CONTEST);

        const vigilguard = (global as any).Hydro?.model?.vigilguard;
        if (!vigilguard?.effectiveContestAccess || !vigilguard?.clientSessionKeyFromSession) {
            throw new Error('Vigil contest access service is unavailable.');
        }
        const sid = vigilguard.clientSessionKeyFromSession((this as any).session);
        const access = await vigilguard.effectiveContestAccess(this.domainId, this.tdoc, this.user._id, sid);
        if (!access.ok) throw new PermissionError(PERM.PERM_ATTEND_CONTEST);
    }

    private async userDict(snapshots: contestTeamCode.TeamCodeSnapshotDoc[]) {
        const uids = new Set<number>();
        for (const snapshot of snapshots) {
            uids.add(snapshot.senderUid);
            uids.add(snapshot.targetUid);
        }
        this.team?.memberUids.forEach((uid) => uids.add(uid));
        return uids.size ? await user.getListForRender(this.domainId, [...uids], false) : {};
    }

    @param('tid', Types.ObjectId)
    @param('snapshotId', Types.ObjectId, true)
    async get(_domainId: string, tid: ObjectId, snapshotId: ObjectId = null) {
        if (snapshotId) {
            const snapshot = await contestTeamCode.openAccessible(this.domainId, tid, snapshotId, this.user);
            if (!snapshot) throw new NotFoundError('Team code snapshot');
            const users = await this.userDict([snapshot]);
            this.response.body = { snapshot: publicSnapshot(snapshot, users, true) };
            return;
        }

        const snapshots = await contestTeamCode.listAccessible(this.domainId, tid, this.user, undefined, this.canManage);
        const users = await this.userDict(snapshots);
        const captain = this.team?.captainUid === this.user._id;
        const targetUids = captain ? this.team.memberUids.filter((uid) => uid !== this.team?.captainUid) : [];
        let presenceError = '';
        let presence = new Map<number, boolean>();
        if (targetUids.length) {
            try {
                presence = new Map((await getTeamCodePresenceOnVigil(tid.toHexString(), targetUids)).map((item) => [item.uid, item.online]));
            } catch (error: any) {
                presenceError = String(error?.message || error);
                logger.error(
                    'Team-code presence failed domain=%s tid=%s team=%s actor=%d targets=%o error=%s',
                    this.domainId,
                    tid,
                    this.team?.teamId,
                    this.user._id,
                    targetUids,
                    presenceError,
                );
            }
        }
        this.response.body = {
            snapshots: snapshots.map((snapshot) => publicSnapshot(snapshot, users)),
            targets: targetUids.map((uid) => ({ ...publicUser(uid, users), online: presence.has(uid) ? presence.get(uid) : null })),
            presenceError: presenceError ? 'presence_unavailable' : null,
            capabilities: {
                canSend: captain,
                canRead: !!this.team || this.canManage,
            },
        };
    }

    @param('tid', Types.ObjectId)
    @param('problemId', Types.UnsignedInt)
    @param('targetUids', Types.CommaSeperatedArray)
    @param('language', Types.String)
    @param('code', TeamCodeSource)
    async postSend(_domainId: string, tid: ObjectId, problemId: number, targetUids: string[], language: string, code: string) {
        const targets = targetUids.map(Number);
        const metadata = contestTeamCode.teamCodeAuditMetadata(code);
        const teamId = this.team?.teamId;
        let snapshots: contestTeamCode.TeamCodeSnapshotDoc[] = [];
        try {
            const vigilguard = (global as any).Hydro?.model?.vigilguard;
            if (!vigilguard?.assertActiveTeamVirtualPrintSession || !vigilguard?.clientSessionKeyFromSession) {
                throw new Error('Vigil virtual-print session service is unavailable.');
            }
            const sid = vigilguard.clientSessionKeyFromSession((this as any).session);
            snapshots = await contestTeamCode.createSnapshots(
                this.domainId,
                tid,
                this.user,
                { problemId, targetUids: targets, language, code },
                async (team) => await vigilguard.assertActiveTeamVirtualPrintSession(sid, this.domainId, tid, this.user._id, team.teamId),
            );
        } catch (error: any) {
            try {
                await oplog.add({
                    type: 'contest.team-code.send',
                    domainId: this.domainId,
                    contestId: tid,
                    ...(teamId ? { teamId } : {}),
                    operator: this.user._id,
                    targetUids: targets.filter((uid) => Number.isSafeInteger(uid)),
                    snapshotIds: [],
                    ...metadata,
                    result: 'rejected',
                    reason: rejectionReason(error),
                    time: new Date(),
                });
            } catch (auditError) {
                logger.error('Failed to audit rejected team-code send domain=%s tid=%s actor=%d error=%o', this.domainId, tid, this.user._id, auditError);
            }
            throw error;
        }

        const notificationFailures: Array<{ snapshotId: string; targetUid: number; reason: string }> = [];
        for (const snapshot of snapshots) {
            const id = snapshot._id.toHexString();
            try {
                await bus.broadcast('contest/team-code-snapshot', {
                    domainId: this.domainId,
                    contestId: tid,
                    teamId: snapshot.teamId,
                    targetUid: snapshot.targetUid,
                    snapshotId: snapshot._id,
                });
            } catch (error: any) {
                notificationFailures.push({ snapshotId: id, targetUid: snapshot.targetUid, reason: String(error?.message || error) });
                logger.error(
                    'Team-code browser wake-up failed domain=%s tid=%s team=%s actor=%d target=%d snapshot=%s error=%s',
                    this.domainId,
                    tid,
                    snapshot.teamId,
                    this.user._id,
                    snapshot.targetUid,
                    id,
                    String(error?.message || error),
                );
            }
        }

        try {
            await oplog.add({
                type: 'contest.team-code.send',
                domainId: this.domainId,
                contestId: tid,
                teamId: snapshots[0].teamId,
                operator: this.user._id,
                targetUids: targets,
                snapshotIds: snapshots.map((snapshot) => snapshot._id),
                ...metadata,
                result: notificationFailures.length ? 'saved_with_wakeup_errors' : 'saved_and_wakeup_dispatched',
                notificationFailures: notificationFailures.map(({ snapshotId, targetUid }) => ({ snapshotId, targetUid })),
                time: new Date(),
            });
        } catch (auditError) {
            logger.error('Team-code snapshots committed but audit failed domain=%s tid=%s actor=%d error=%o', this.domainId, tid, this.user._id, auditError);
        }

        const users = await this.userDict(snapshots);
        this.response.body = {
            snapshots: snapshots.map((snapshot) => publicSnapshot(snapshot, users)),
            notificationFailures: notificationFailures.map(({ snapshotId, targetUid }) => ({ snapshotId, targetUid })),
        };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('exam_mode_team_code', '/exam-mode/:tid/team-code', ContestTeamCodeHandler, PRIV.PRIV_USER_PROFILE);
}
