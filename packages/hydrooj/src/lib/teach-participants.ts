import { parseTeachType, teachDocKind, type TeachType } from '@hydrooj/common';
import { ObjectId } from 'mongodb';
import {
    localizeError,
    localizedErrorText,
    NotFoundError,
    PermissionError,
    ValidationError,
} from '../error';
import type { Udict } from '../interface';
import { assertTeachManage, type TeachActor, type TeachDoc } from './teach-access';
import { logger } from '../logger';
import { PERM, PRIV } from '../model/builtin';
import * as document from '../model/document';
import user from '../model/user';
import {
    studentDirectory,
    type StudentDirectoryGroup,
    type StudentDirectoryStudent,
} from '../service/student-directory';

const PARTICIPANT_LIMIT = 2000;

export interface TeachParticipant {
    uid: number;
    uname: string;
    studentId: string;
    realName: string;
    groupIds: string[];
    attended: boolean;
    startAt: string | null;
    finalizedAt: string | null;
    lastSubmitAt: string | null;
    late: boolean;
}

export interface TeachParticipantsPayload {
    participants: TeachParticipant[];
    groups: Array<{ id: string; name: string }>;
}

interface ParticipantFact {
    attended: boolean;
    startAt: string | null;
    finalizedAt: string | null;
    lastSubmitAt: string | null;
    late: boolean;
}

function tooManyParticipants(): never {
    throw new ValidationError('participants', null, localizedErrorText`参与人数超过 2000，请到排行榜导出`);
}

function invalidParticipants(): never {
    throw new ValidationError('participants', null, localizedErrorText`参与记录无效`);
}

function invalidSubmission(): never {
    throw new ValidationError('participants', null, localizedErrorText`参与记录的提交无效`);
}

function invalidGroup(): never {
    throw new ValidationError('participants', null, localizedErrorText`用户组参数无效`);
}

function invalidStudent(): never {
    throw new ValidationError('participants', null, localizedErrorText`学生记录无效`);
}

function isRow(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readUid(row: Record<string, unknown>): number {
    if (typeof row.uid !== 'number' || !Number.isSafeInteger(row.uid)) invalidParticipants();
    return row.uid;
}

function readOptionalDate(value: unknown, field: string): Date | null {
    if (value == null) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    throw new ValidationError(field, null, localizedErrorText`参与记录的时间无效`);
}

function readRidTimestamp(entry: unknown): number {
    if (!isRow(entry) || !(entry.rid instanceof ObjectId)) invalidSubmission();
    const timestamp = entry.rid.getTimestamp();
    const time = timestamp.getTime();
    if (Number.isNaN(time)) invalidSubmission();
    return time;
}

function readJournal(journal: unknown, penaltySince: Date | null, countLate: boolean): { lastSubmitAt: string | null; late: boolean } {
    if (journal == null) return { lastSubmitAt: null, late: false };
    if (!Array.isArray(journal)) invalidSubmission();
    let latest: number | null = null;
    let late = false;
    for (const entry of journal) {
        const time = readRidTimestamp(entry);
        if (latest === null || time > latest) latest = time;
        if (countLate && penaltySince && time > penaltySince.getTime()) late = true;
    }
    return {
        lastSubmitAt: latest === null ? null : new Date(latest).toISOString(),
        late,
    };
}

function absentFact(): ParticipantFact {
    return {
        attended: false,
        startAt: null,
        finalizedAt: null,
        lastSubmitAt: null,
        late: false,
    };
}

function readStatusFact(row: Record<string, unknown>, input: { isExam: boolean; penaltySince: Date | null; countLate: boolean }): ParticipantFact {
    const started = readOptionalDate(row.startAt, 'startAt');
    const finalized = input.isExam ? readOptionalDate(row.paperFinalizedAt, 'paperFinalizedAt') : null;
    const journal = readJournal(row.journal, input.penaltySince, input.countLate);
    return {
        attended: row.attend === 1,
        startAt: started ? started.toISOString() : null,
        finalizedAt: finalized ? finalized.toISOString() : null,
        lastSubmitAt: journal.lastSubmitAt,
        late: journal.late,
    };
}

function audienceGroupIds(doc: TeachDoc, type: TeachType): ObjectId[] {
    if (teachDocKind(type) !== 'contest' || doc.participantScopeMode !== 'groups') return [];
    const raw = doc.participantGroupIds;
    if (raw == null) return [];
    if (!Array.isArray(raw)) throw new ValidationError('participantGroupIds', null, localizedErrorText`用户组参数无效`);
    const ids: ObjectId[] = [];
    for (const item of raw) {
        if (!(item instanceof ObjectId)) throw new ValidationError('participantGroupIds', null, localizedErrorText`用户组参数无效`);
        ids.push(item);
    }
    return ids;
}

function isArchivedGroup(group: StudentDirectoryGroup): boolean {
    if (group.archivedAt == null) return false;
    if (group.archivedAt instanceof Date && !Number.isNaN(group.archivedAt.getTime())) return true;
    invalidGroup();
}

function activeGroupNames(groups: readonly StudentDirectoryGroup[]): Map<string, string> {
    const active = new Map<string, string>();
    for (const group of groups) {
        if (isArchivedGroup(group)) continue;
        if (!(group._id instanceof ObjectId) || typeof group.name !== 'string') invalidGroup();
        active.set(group._id.toHexString(), group.name);
    }
    return active;
}

function projectGroupIds(raw: unknown, active: ReadonlyMap<string, string>): string[] {
    if (raw == null) return [];
    if (!Array.isArray(raw)) invalidGroup();
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        if (!(item instanceof ObjectId)) invalidGroup();
        const hex = item.toHexString();
        if (!active.has(hex) || seen.has(hex)) continue;
        seen.add(hex);
        ids.push(hex);
    }
    return ids;
}

function readStudent(student: StudentDirectoryStudent | undefined, active: ReadonlyMap<string, string>): { studentId: string; realName: string; groupIds: string[] } {
    if (!student) return { studentId: '', realName: '', groupIds: [] };
    if (typeof student.studentId !== 'string' || typeof student.realName !== 'string') invalidStudent();
    return {
        studentId: student.studentId,
        realName: student.realName,
        groupIds: projectGroupIds(student.groupIds, active),
    };
}

function readUname(udict: Udict, uid: number): string {
    const uname = udict[uid]?.uname;
    if (typeof uname !== 'string') throw new ValidationError('participants', null, localizedErrorText`找不到这位用户的用户名`);
    return uname;
}

function readBoundUserId(student: StudentDirectoryStudent): number {
    const uid = student.boundUserId;
    if (typeof uid !== 'number' || !Number.isSafeInteger(uid)) invalidStudent();
    return uid;
}

function compareParticipants(left: TeachParticipant, right: TeachParticipant): number {
    if (left.studentId !== right.studentId) {
        if (left.studentId === '') return 1;
        if (right.studentId === '') return -1;
        return left.studentId < right.studentId ? -1 : 1;
    }
    return left.uid - right.uid;
}

function compareGroups(left: { id: string; name: string }, right: { id: string; name: string }): number {
    const byName = left.name.localeCompare(right.name, 'zh-CN');
    if (byName !== 0) return byName;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

async function loadStatusRows(domainId: string, docType: number, query: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const rows: unknown = await document.getMultiStatus(domainId, docType, query).toArray();
    if (!Array.isArray(rows)) invalidParticipants();
    return rows.map((row) => {
        if (!isRow(row)) invalidParticipants();
        return row;
    });
}

function rememberFact(facts: Map<number, ParticipantFact>, uid: number, fact: ParticipantFact): void {
    if (uid <= 1) return;
    if (facts.has(uid)) throw new ValidationError('participants', null, localizedErrorText`同一位用户有多条参与记录，不能列出名单`);
    facts.set(uid, fact);
}

function parseType(type: unknown): TeachType {
    try {
        return parseTeachType(type);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'teach_type_invalid') {
            throw localizeError(new NotFoundError(), '题目集不存在');
        }
        throw error;
    }
}

export async function loadTeachParticipants(domainId: string, actor: TeachActor, type: unknown, id: ObjectId): Promise<TeachParticipantsPayload> {
    if (!(id instanceof ObjectId)) throw localizeError(new NotFoundError(), '题目集不存在');
    const parsed = parseType(type);
    const doc = await assertTeachManage(domainId, actor, parsed, id);
    if (!actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && !actor.hasPerm(PERM.PERM_USERBIND_MANAGE_STUDENTS)) {
        throw new PermissionError(PERM.PERM_USERBIND_MANAGE_STUDENTS);
    }
    const practice = teachDocKind(parsed) === 'training';
    const rule = typeof doc.rule === 'string' ? doc.rule : '';
    const countLate = rule === 'homework';
    const penaltySince = countLate ? readOptionalDate(doc.penaltySince, 'penaltySince') : null;
    const isExam = rule === 'exam';
    const rows = await loadStatusRows(
        domainId,
        practice ? document.TYPE_TRAINING : document.TYPE_CONTEST,
        practice ? { docId: id, uid: { $gt: 1 }, enroll: 1 } : { docId: id, uid: { $gt: 1 }, attend: 1 },
    );
    const facts = new Map<number, ParticipantFact>();
    for (const row of rows) {
        const enrolled = practice ? row.enroll === 1 : row.attend === 1;
        if (!enrolled) continue;
        rememberFact(facts, readUid(row), readStatusFact(row, { isExam, penaltySince, countLate }));
    }
    if (facts.size > PARTICIPANT_LIMIT) tooManyParticipants();
    const groupIds = audienceGroupIds(doc, parsed);
    if (groupIds.length > 0) {
        const bound = await studentDirectory().findBoundStudentsByGroupIds(domainId, groupIds);
        for (const student of bound) {
            const uid = readBoundUserId(student);
            if (uid <= 1 || facts.has(uid)) continue;
            facts.set(uid, absentFact());
        }
        if (facts.size > PARTICIPANT_LIMIT) tooManyParticipants();
    }
    const uids = [...facts.keys()];
    const directory = studentDirectory();
    const [udict, students, listedGroups] = await Promise.all([
        uids.length ? user.getList(domainId, uids) : {},
        uids.length ? directory.findStudentsByUserIds(domainId, uids) : {},
        uids.length ? directory.listUserGroups(domainId) : [],
    ]);
    const active = activeGroupNames(listedGroups);
    const participants = uids.map((uid) => {
        const fact = facts.get(uid) || absentFact();
        const identity = readStudent(students[String(uid)], active);
        return {
            uid,
            uname: readUname(udict, uid),
            studentId: identity.studentId,
            realName: identity.realName,
            groupIds: identity.groupIds,
            attended: fact.attended,
            startAt: fact.startAt,
            finalizedAt: fact.finalizedAt,
            lastSubmitAt: fact.lastSubmitAt,
            late: fact.late,
        };
    });
    participants.sort(compareParticipants);
    const referenced = new Map<string, string>();
    for (const person of participants) {
        for (const groupId of person.groupIds) {
            const name = active.get(groupId);
            if (name === undefined) invalidGroup();
            referenced.set(groupId, name);
        }
    }
    const groups = [...referenced.entries()].map(([groupId, name]) => ({ id: groupId, name })).sort(compareGroups);
    logger.info('teach participants domain=%s container=%s actor=%d count=%d', domainId, id.toHexString(), actor._id, participants.length);
    return { participants, groups };
}
