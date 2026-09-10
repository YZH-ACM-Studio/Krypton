import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import type { Tdoc } from '../interface';
import { PRIV } from './builtin';
import type { ExamEventDoc } from './exam-event';
import {
    ExamRosterResolutionSource,
    ExamRosterRevisionDoc,
    ExamRosterUserState,
    ExamSeatPlanError,
    resolveStableExamRoster,
    ResolvedExamRoster,
} from './exam-seat-plan';
import UserModel from './user';

export type ExamRosterSelection = { kind: 'contestAudience' } | { kind: 'userbindGroups'; groupIds: ObjectId[] } | { kind: 'userbindSchool' };

function sha256(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function requireUserbind() {
    const userbind = global.Hydro.model.userbind;
    if (!userbind || typeof userbind.loadExamRosterUserbindSnapshot !== 'function') {
        throw new ExamSeatPlanError('userbind_roster_resolver_unavailable');
    }
    return userbind;
}

async function loadUserbindSnapshot(domainId: string, schoolId: ObjectId, groupIds: ObjectId[] | null) {
    try {
        return await requireUserbind().loadExamRosterUserbindSnapshot(domainId, schoolId, groupIds);
    } catch (error) {
        if (
            error instanceof Error &&
            error.name === 'ExamRosterUserbindSourceError' &&
            typeof (error as Error & { reason?: unknown }).reason === 'string' &&
            /^[a-z][a-z0-9_]{0,63}$/.test((error as Error & { reason: string }).reason)
        ) {
            throw new ExamSeatPlanError((error as Error & { reason: string }).reason);
        }
        throw error;
    }
}

function canonicalObjectIds(values: unknown, field: string): ObjectId[] {
    if (!Array.isArray(values) || values.some((value) => !(value instanceof ObjectId))) throw new ExamSeatPlanError(`${field}_invalid`);
    const result = values.map((value) => new ObjectId(value)).sort((left, right) => left.toHexString().localeCompare(right.toHexString()));
    if (new Set(result.map((value) => value.toHexString())).size !== result.length) throw new ExamSeatPlanError(`${field}_duplicate`);
    return result;
}

function snapshotToSource(
    snapshot: Awaited<ReturnType<NonNullable<typeof global.Hydro.model.userbind>['loadExamRosterUserbindSnapshot']>>,
    kind: ExamRosterResolutionSource['kind'],
    contestId: ObjectId | null,
): ExamRosterResolutionSource {
    return {
        kind,
        schoolId: new ObjectId(snapshot.schoolId),
        selectedGroupIds: snapshot.selectedGroupIds.map((id) => new ObjectId(id)),
        contestId: contestId ? new ObjectId(contestId) : null,
        sourceFingerprint: snapshot.fingerprint,
        groups: snapshot.groups.map((group) => ({
            groupId: new ObjectId(group.groupId),
            schoolId: new ObjectId(group.schoolId),
            name: group.name,
            archivedAt: group.archivedAt ? new Date(group.archivedAt) : null,
            fingerprint: group.fingerprint,
        })),
        students: snapshot.students.map((student) => ({
            studentRecordId: new ObjectId(student.studentRecordId),
            schoolId: new ObjectId(student.schoolId),
            studentId: student.studentId,
            realName: student.realName,
            groupIds: student.groupIds.map((groupId) => new ObjectId(groupId)),
            boundUserId: student.boundUserId,
        })),
    };
}

function assertContestIdentity(event: ExamEventDoc, contest: Tdoc): void {
    const contestId = contest.docId || contest._id;
    if (contest.domainId !== event.domainId || !(contestId instanceof ObjectId) || !event.contestId?.equals(contestId)) {
        throw new ExamSeatPlanError('contest_identity_mismatch');
    }
}

function contestAudienceConfiguration(tdoc: Tdoc) {
    if (tdoc.participantScopeMode !== undefined && !['none', 'schools', 'groups'].includes(tdoc.participantScopeMode)) {
        throw new ExamSeatPlanError('contest_audience_invalid');
    }
    if (tdoc.participantSchoolIds !== undefined && !Array.isArray(tdoc.participantSchoolIds)) {
        throw new ExamSeatPlanError('contest_audience_invalid');
    }
    if (tdoc.participantGroupIds !== undefined && !Array.isArray(tdoc.participantGroupIds)) {
        throw new ExamSeatPlanError('contest_audience_invalid');
    }
    if (tdoc.assign !== undefined && !Array.isArray(tdoc.assign)) throw new ExamSeatPlanError('contest_audience_invalid');
    const participantScopeMode = tdoc.participantScopeMode ?? 'none';
    const participantSchoolIds = canonicalObjectIds(tdoc.participantSchoolIds ?? [], 'contest_school_scope');
    const participantGroupIds = canonicalObjectIds(tdoc.participantGroupIds ?? [], 'contest_group_scope');
    if (participantScopeMode === 'schools' && (!participantSchoolIds.length || participantGroupIds.length)) {
        throw new ExamSeatPlanError('contest_audience_invalid');
    }
    if (participantScopeMode === 'groups' && (!participantGroupIds.length || participantSchoolIds.length)) {
        throw new ExamSeatPlanError('contest_audience_invalid');
    }
    if (participantScopeMode === 'none' && (participantSchoolIds.length || participantGroupIds.length)) {
        throw new ExamSeatPlanError('contest_audience_invalid');
    }
    const assign = [...(tdoc.assign ?? [])].map((name) => {
        if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 64) {
            throw new ExamSeatPlanError('contest_assign_invalid');
        }
        return name;
    });
    assign.sort();
    if (new Set(assign).size !== assign.length) throw new ExamSeatPlanError('contest_assign_duplicate');
    return { participantScopeMode, participantSchoolIds, participantGroupIds, assign };
}

export type ExamContestAudienceState = 'fixed' | 'not-applicable' | 'public';

async function contestAudienceContext(event: ExamEventDoc) {
    if (event.type !== 'krypton' || !event.contestId) return null;
    const contest = await global.Hydro.model.contest.get(event.domainId, event.contestId);
    assertContestIdentity(event, contest);
    const config = contestAudienceConfiguration(contest);
    if (contest._code !== undefined && typeof contest._code !== 'string') throw new ExamSeatPlanError('contest_audience_invalid');
    if (contest.participationMode !== undefined && contest.participationMode !== 'individual' && contest.participationMode !== 'team') {
        throw new ExamSeatPlanError('contest_audience_invalid');
    }
    const participationMode = contest.participationMode || 'individual';
    if (participationMode === 'team') {
        if (contest.rule !== 'acm') throw new ExamSeatPlanError('contest_audience_invalid');
        if (contest.plannedTeamBatchId && !contest.teamBatchId) throw new ExamSeatPlanError('contest_team_roster_not_finalized');
        return { config, contest, participationMode, state: 'fixed' as const };
    }
    // An invite code controls entry, but it does not freeze who may join later.
    // Only an explicit audience scope can be used as a stable automatic-seat roster.
    const state = !contest._code && (config.participantScopeMode !== 'none' || config.assign.length) ? 'fixed' : 'public';
    return { config, contest, participationMode, state } as const;
}

export async function getExamContestAudienceState(event: ExamEventDoc): Promise<ExamContestAudienceState> {
    const context = await contestAudienceContext(event);
    return context?.state || 'not-applicable';
}

async function attendedUserIds(domainId: string, contestId: ObjectId): Promise<number[]> {
    const statuses = await global.Hydro.model.contest.getMultiStatus(domainId, { docId: contestId, attend: 1 }).toArray();
    if (statuses.some((status) => typeof status.uid !== 'number' || !Number.isSafeInteger(status.uid) || status.uid <= 1)) {
        throw new ExamSeatPlanError('contest_attendance_invalid');
    }
    const uids = statuses.map((status) => status.uid as number).sort((left, right) => left - right);
    if (new Set(uids).size !== uids.length) throw new ExamSeatPlanError('contest_attendance_duplicate');
    return uids;
}

async function assignedUserIds(domainId: string, names: string[]): Promise<number[]> {
    if (!names.length) return [];
    const groups = await UserModel.collGroup.find({ domainId, name: { $in: names } }).toArray();
    if (groups.length !== names.length || new Set(groups.map((group) => group.name)).size !== names.length) {
        throw new ExamSeatPlanError('contest_assign_group_not_found');
    }
    const uids = groups.flatMap((group) => {
        if (!Array.isArray(group.uids) || group.uids.some((uid) => !Number.isSafeInteger(uid) || uid < 1)) {
            throw new ExamSeatPlanError('contest_assign_group_invalid');
        }
        return group.uids;
    });
    return Array.from(new Set(uids)).sort((left, right) => left - right);
}

async function contestAudienceSource(event: ExamEventDoc): Promise<ExamRosterResolutionSource> {
    if (event.type !== 'krypton' || !event.contestId) throw new ExamSeatPlanError('contest_audience_unavailable');
    const context = await contestAudienceContext(event);
    if (!context) throw new ExamSeatPlanError('contest_audience_unavailable');
    if (context.state === 'public') throw new ExamSeatPlanError('contest_audience_not_fixed');
    const { config, contest, participationMode } = context;
    let teamAudience: { memberUids: number[]; teamFacts: Array<{ teamId: string; revision: number; memberUids: number[] }> } | null = null;
    if (participationMode === 'team') {
        const teams = await global.Hydro.model.contestTeam.listTeams(event.domainId, event.contestId);
        const teamIds = new Set<string>();
        const memberUids = new Set<number>();
        const teamFacts = teams.map((team) => {
            if (
                !(team.teamId instanceof ObjectId) ||
                typeof team.revision !== 'number' ||
                !Number.isSafeInteger(team.revision) ||
                team.revision < 1 ||
                !Array.isArray(team.memberUids) ||
                team.memberUids.length < 1 ||
                team.memberUids.length > 3 ||
                team.memberUids.some((uid) => typeof uid !== 'number' || !Number.isSafeInteger(uid) || uid <= 1) ||
                new Set(team.memberUids).size !== team.memberUids.length
            ) {
                throw new ExamSeatPlanError('contest_team_roster_invalid');
            }
            const teamId = team.teamId.toHexString();
            if (teamIds.has(teamId) || team.memberUids.some((uid) => memberUids.has(uid))) {
                throw new ExamSeatPlanError('contest_team_roster_invalid');
            }
            teamIds.add(teamId);
            team.memberUids.forEach((uid) => memberUids.add(uid));
            return { teamId, revision: team.revision, memberUids: [...team.memberUids].sort((left, right) => left - right) };
        });
        teamFacts.sort((left, right) => left.teamId.localeCompare(right.teamId));
        teamAudience = { memberUids: [...memberUids].sort((left, right) => left - right), teamFacts };
    }
    if (participationMode === 'individual' && config.participantScopeMode === 'schools') {
        if (config.participantSchoolIds.some((schoolId) => !schoolId.equals(event.schoolId))) {
            throw new ExamSeatPlanError('contest_audience_cross_school');
        }
    }
    const selectedGroupIds = participationMode === 'individual' && config.participantScopeMode === 'groups' ? config.participantGroupIds : null;
    const snapshot = await loadUserbindSnapshot(event.domainId, event.schoolId, selectedGroupIds);
    let students = snapshot.students;
    let audienceFacts: Record<string, unknown>;

    if (participationMode === 'team') {
        const { memberUids, teamFacts } = teamAudience!;
        const recordsByUid = new Map(
            snapshot.students.flatMap((student) => (student.boundUserId === null ? [] : [[student.boundUserId, student] as const])),
        );
        if (memberUids.some((uid) => !recordsByUid.has(uid))) throw new ExamSeatPlanError('contest_audience_userbind_missing');
        students = snapshot.students.filter((student) => student.boundUserId !== null && memberUids.includes(student.boundUserId));
        audienceFacts = {
            participationMode: 'team',
            participationRevision: contest.participationRevision || null,
            teamBatchId: contest.teamBatchId?.toHexString() || null,
            teams: teamFacts,
        };
    } else {
        const hasExplicitScope = config.participantScopeMode !== 'none';
        const needsAttendance = !!contest._code || (!hasExplicitScope && !config.assign.length);
        const [attended, assigned] = await Promise.all([
            needsAttendance ? attendedUserIds(event.domainId, event.contestId) : Promise.resolve([]),
            assignedUserIds(event.domainId, config.assign),
        ]);
        const recordsByUid = new Map(
            snapshot.students.flatMap((student) => (student.boundUserId === null ? [] : [[student.boundUserId, student] as const])),
        );
        if (!hasExplicitScope && [...attended, ...assigned].some((uid) => !recordsByUid.has(uid))) {
            throw new ExamSeatPlanError('contest_audience_userbind_missing');
        }
        const relevantAttended = attended.filter((uid) => recordsByUid.has(uid));
        const relevantAssigned = assigned.filter((uid) => recordsByUid.has(uid));
        if (!hasExplicitScope || config.assign.length || needsAttendance) {
            students = snapshot.students.filter((student) => {
                if (student.boundUserId === null) return hasExplicitScope && !config.assign.length && !needsAttendance;
                if (config.assign.length && !relevantAssigned.includes(student.boundUserId)) return false;
                if (needsAttendance && !relevantAttended.includes(student.boundUserId)) return false;
                return true;
            });
        }
        audienceFacts = {
            participationMode: 'individual',
            participantScopeMode: config.participantScopeMode,
            participantSchoolIds: config.participantSchoolIds.map((id) => id.toHexString()),
            participantGroupIds: config.participantGroupIds.map((id) => id.toHexString()),
            assign: config.assign,
            inviteCodeRequired: !!contest._code,
            attended: relevantAttended,
            assigned: relevantAssigned,
        };
    }

    const sourceFingerprint = sha256({
        contestId: event.contestId.toHexString(),
        userbindFingerprint: snapshot.fingerprint,
        audienceFacts,
        selectedStudentRecordIds: students.map((student) => student.studentRecordId.toHexString()).sort(),
    });
    return {
        ...snapshotToSource({ ...snapshot, students }, 'contestAudience', event.contestId),
        sourceFingerprint,
    };
}

export async function loadExamRosterResolutionSource(event: ExamEventDoc, selection: ExamRosterSelection): Promise<ExamRosterResolutionSource> {
    if (selection.kind === 'contestAudience') return contestAudienceSource(event);
    const groupIds = selection.kind === 'userbindGroups' ? canonicalObjectIds(selection.groupIds, 'selected_group_ids') : null;
    if (groupIds !== null && (!groupIds.length || groupIds.length > 100)) throw new ExamSeatPlanError('selected_group_ids_invalid');
    const snapshot = await loadUserbindSnapshot(event.domainId, event.schoolId, groupIds);
    return snapshotToSource(snapshot, selection.kind, null);
}

export async function loadExamRosterUserStates(uids: number[]): Promise<ExamRosterUserState[]> {
    if (!Array.isArray(uids) || uids.some((uid) => !Number.isSafeInteger(uid) || uid < 1)) throw new ExamSeatPlanError('user_ids_invalid');
    if (!uids.length) return [];
    const users = await UserModel.coll
        .find({ _id: { $in: uids } }, { projection: { _id: 1, priv: 1 } })
        .sort({ _id: 1 })
        .toArray();
    return users.map((user) => {
        if (
            typeof user._id !== 'number' ||
            !Number.isSafeInteger(user._id) ||
            user._id < 1 ||
            typeof user.priv !== 'number' ||
            !Number.isSafeInteger(user.priv) ||
            (user.priv | 0) !== user.priv
        ) {
            throw new ExamSeatPlanError('user_state_invalid');
        }
        return {
            uid: user._id,
            active: (user.priv & PRIV.PRIV_USER_PROFILE) === PRIV.PRIV_USER_PROFILE,
        };
    });
}

export function resolveExamRosterForEvent(event: ExamEventDoc, selection: ExamRosterSelection): Promise<ResolvedExamRoster> {
    return resolveStableExamRoster({
        schoolId: event.schoolId,
        loadSource: () => loadExamRosterResolutionSource(event, selection),
        loadUserStates: loadExamRosterUserStates,
    });
}

function rosterEntriesFingerprint(entries: ExamRosterRevisionDoc['entries']): string {
    return sha256(
        entries.map((entry) => ({
            studentRecordId: entry.studentRecordId.toHexString(),
            schoolId: entry.schoolId.toHexString(),
            studentId: entry.studentId,
            realName: entry.realName,
            boundUserId: entry.boundUserId,
            sourceGroupIds: entry.sourceGroupIds.map((id) => id.toHexString()),
        })),
    );
}

function rosterExclusionsFingerprint(exclusions: ExamRosterRevisionDoc['exclusions']): string {
    return sha256(
        exclusions.map((entry) => ({
            studentRecordId: entry.studentRecordId.toHexString(),
            schoolId: entry.schoolId.toHexString(),
            studentId: entry.studentId,
            realName: entry.realName,
            boundUserId: entry.boundUserId,
            reason: entry.reason,
        })),
    );
}

export async function assertExamContestAudienceRosterCurrent(event: ExamEventDoc, roster: ExamRosterRevisionDoc): Promise<void> {
    if (roster.source.kind !== 'contestAudience') return;
    if (event.type !== 'krypton' || !event.contestId || !roster.source.contestId?.equals(event.contestId)) {
        throw new ExamSeatPlanError('roster_contest_changed');
    }
    const current = await resolveExamRosterForEvent(event, { kind: 'contestAudience' });
    if (
        current.source.sourceFingerprint !== roster.source.sourceFingerprint ||
        rosterEntriesFingerprint(current.entries) !== rosterEntriesFingerprint(roster.entries) ||
        rosterExclusionsFingerprint(current.exclusions) !== rosterExclusionsFingerprint(roster.exclusions)
    ) {
        throw new ExamSeatPlanError('roster_source_changed');
    }
}

function storedRosterSelection(roster: ExamRosterRevisionDoc): ExamRosterSelection {
    return roster.source.kind === 'contestAudience'
        ? { kind: 'contestAudience' }
        : roster.source.kind === 'userbindGroups'
          ? { kind: 'userbindGroups', groupIds: roster.source.selectedGroupIds.map((groupId) => new ObjectId(groupId)) }
          : { kind: 'userbindSchool' };
}

export async function resolveCurrentExamRoster(event: ExamEventDoc, roster: ExamRosterRevisionDoc): Promise<ResolvedExamRoster> {
    if (roster.domainId !== event.domainId || !roster.eventId.equals(event._id) || !roster.schoolId.equals(event.schoolId)) {
        throw new ExamSeatPlanError('roster_source_changed');
    }
    const current = await resolveExamRosterForEvent(event, storedRosterSelection(roster));
    if (current.source.kind !== roster.source.kind) throw new ExamSeatPlanError('roster_source_changed');
    return current;
}

export interface ExamRosterFrozenParticipant {
    boundUserId: number;
    studentRecordId: ObjectId;
    studentId: string;
    teamId: string | null;
    teamRole: 'captain' | 'member' | null;
}

export interface ExamRosterDriftItem {
    boundUserId: number;
    studentId: string;
    realName: string;
    kind: 'added' | 'removed' | 'identity_changed' | 'team_changed';
    previousTeamId: string | null;
    previousTeamRole: 'captain' | 'member' | null;
    currentTeamId: string | null;
    currentTeamRole: 'captain' | 'member' | null;
}

export interface ExamRosterDrift {
    changed: boolean;
    sourceChangedWithoutParticipantDiff: boolean;
    items: ExamRosterDriftItem[];
}

async function currentTeamFacts(
    event: ExamEventDoc,
    roster: ExamRosterRevisionDoc,
): Promise<{ roster: ResolvedExamRoster; teams: Map<number, { teamId: string; teamRole: 'captain' | 'member' }> }> {
    const current = await resolveCurrentExamRoster(event, roster);
    const teams = new Map<number, { teamId: string; teamRole: 'captain' | 'member' }>();
    if (event.type !== 'krypton' || !event.contestId) return { roster: current, teams };
    const context = await contestAudienceContext(event);
    if (!context || context.participationMode !== 'team') return { roster: current, teams };
    if (roster.source.kind !== 'contestAudience') throw new ExamSeatPlanError('roster_source_changed');
    const contestTeams = await global.Hydro.model.contestTeam.listTeams(event.domainId, event.contestId);
    const teamIds = new Set<string>();
    for (const team of contestTeams) {
        if (
            !(team.teamId instanceof ObjectId) ||
            !Number.isSafeInteger(team.revision) ||
            team.revision < 1 ||
            !Number.isSafeInteger(team.captainUid) ||
            !Array.isArray(team.memberUids) ||
            team.memberUids.length < 1 ||
            team.memberUids.length > 3 ||
            !team.memberUids.includes(team.captainUid) ||
            team.memberUids.some((uid) => !Number.isSafeInteger(uid) || uid <= 1)
        ) {
            throw new ExamSeatPlanError('contest_team_roster_invalid');
        }
        const teamId = team.teamId.toHexString();
        if (teamIds.has(teamId)) throw new ExamSeatPlanError('contest_team_roster_invalid');
        teamIds.add(teamId);
        for (const uid of team.memberUids) {
            if (teams.has(uid)) throw new ExamSeatPlanError('contest_team_roster_invalid');
            teams.set(uid, { teamId, teamRole: uid === team.captainUid ? 'captain' : 'member' });
        }
    }
    if (teams.size !== current.entries.length || current.entries.some((entry) => !teams.has(entry.boundUserId))) {
        throw new ExamSeatPlanError('contest_team_roster_invalid');
    }
    return { roster: current, teams };
}

export async function inspectExamRosterDrift(
    event: ExamEventDoc,
    roster: ExamRosterRevisionDoc,
    frozenParticipants: ExamRosterFrozenParticipant[],
): Promise<ExamRosterDrift> {
    const { roster: current, teams } = await currentTeamFacts(event, roster);
    const frozenEntries = new Map(roster.entries.map((entry) => [entry.boundUserId, entry]));
    const currentEntries = new Map(current.entries.map((entry) => [entry.boundUserId, entry]));
    const frozenByUid = new Map(frozenParticipants.map((participant) => [participant.boundUserId, participant]));
    if (frozenByUid.size !== frozenParticipants.length || frozenByUid.size !== frozenEntries.size) {
        throw new ExamSeatPlanError('roster_source_changed');
    }
    const items: ExamRosterDriftItem[] = [];
    const uids = Array.from(new Set([...frozenEntries.keys(), ...currentEntries.keys()])).sort((left, right) => left - right);
    for (const uid of uids) {
        const frozenEntry = frozenEntries.get(uid);
        const currentEntry = currentEntries.get(uid);
        const frozenParticipant = frozenByUid.get(uid);
        const currentTeam = teams.get(uid) || null;
        const previousTeamId = frozenParticipant?.teamId || null;
        const previousTeamRole = frozenParticipant?.teamRole || null;
        const currentTeamId = currentTeam?.teamId || null;
        const currentTeamRole = currentTeam?.teamRole || null;
        const common = {
            boundUserId: uid,
            studentId: currentEntry?.studentId || frozenEntry?.studentId || frozenParticipant?.studentId || '',
            realName: currentEntry?.realName || frozenEntry?.realName || '',
            previousTeamId,
            previousTeamRole,
            currentTeamId,
            currentTeamRole,
        };
        if (!frozenEntry || !frozenParticipant) items.push({ ...common, kind: 'added' });
        else if (!currentEntry) items.push({ ...common, kind: 'removed' });
        else if (
            !currentEntry.studentRecordId.equals(frozenEntry.studentRecordId) ||
            currentEntry.studentId !== frozenEntry.studentId ||
            currentEntry.realName !== frozenEntry.realName
        ) {
            items.push({ ...common, kind: 'identity_changed' });
        } else if (previousTeamId !== currentTeamId || previousTeamRole !== currentTeamRole) {
            items.push({ ...common, kind: 'team_changed' });
        }
    }
    const sourceChanged =
        current.source.sourceFingerprint !== roster.source.sourceFingerprint ||
        rosterEntriesFingerprint(current.entries) !== rosterEntriesFingerprint(roster.entries) ||
        rosterExclusionsFingerprint(current.exclusions) !== rosterExclusionsFingerprint(roster.exclusions);
    return {
        changed: sourceChanged || items.length > 0,
        sourceChangedWithoutParticipantDiff: sourceChanged && items.length === 0,
        items,
    };
}

export async function assertExamRosterCurrent(event: ExamEventDoc, roster: ExamRosterRevisionDoc): Promise<void> {
    const current = await resolveCurrentExamRoster(event, roster);
    if (
        current.source.sourceFingerprint !== roster.source.sourceFingerprint ||
        rosterEntriesFingerprint(current.entries) !== rosterEntriesFingerprint(roster.entries) ||
        rosterExclusionsFingerprint(current.exclusions) !== rosterExclusionsFingerprint(roster.exclusions)
    ) {
        throw new ExamSeatPlanError('roster_source_changed');
    }
}
