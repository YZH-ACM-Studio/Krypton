import { ObjectId } from 'mongodb';
import {
    examPaperQuotaTotal,
    readExamPaperQuotas,
    teachStatusOf,
    teachTypeOfContestRule,
    type TeachStatus,
    type TeachType,
} from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import { localizedErrorText, ValidationError } from '../error';
import type { Tdoc, TrainingDoc } from '../interface';
import { TYPE_CONTEST, TYPE_TRAINING } from '../model/document';
import { problemSetAudienceOf } from './problem-set-audience';
import { type TeachActor, teachRoleOf } from './teach-access';
import { readSchoolShared } from './teach-fields';
import { isProblemSetKind } from './training-kind';

const logger = new Logger('teach-list');
const AUDIENCE_UNREADABLE = '受众数据无效';

export const TEACH_LIST_PAGE_SIZE = 20;

export type TeachListScope = 'mine' | 'shared' | 'all';
export type TeachListTypeFilter = 'all' | 'practice' | 'quiz' | 'acm' | 'oi';
export type TeachListStatusFilter = 'all' | TeachStatus;

export interface TeachListRow {
    type: TeachType;
    id: string;
    rule: string;
    title: string;
    status: TeachStatus;
    beginAt: string | null;
    endAt: string | null;
    durationMinutes: number | null;
    audience: string;
    problemCount: number;
    drawCount: number | null;
    stageCount: number | null;
    participantCount: number;
    role: 'owner' | 'maintainer' | 'admin';
    shared: boolean;
    createdAt: string;
}

export interface TeachSharedRow {
    type: TeachType;
    id: string;
    rule: string;
    title: string;
    ownerUid: number;
    ownerName: string;
    problemCount: number;
    drawCount: number | null;
    beginAt: string | null;
    endAt: string | null;
    durationMinutes: number | null;
    sharedAt: string;
}

export interface TeachListPayload {
    scope: TeachListScope;
    canSeeAll: boolean;
    filter: { type: TeachListTypeFilter; status: TeachListStatusFilter; q: string };
    typeCounts: Record<'all' | 'practice' | 'quiz' | 'acm' | 'oi', number>;
    page: number;
    pageCount: number;
    total: number;
    rows: TeachListRow[];
    sharedRows: TeachSharedRow[];
    canCreate: Record<TeachType, boolean>;
}

export interface TeachListRowContext {
    actor: TeachActor;
    now: Date;
    participantCount: number;
    groupNames: ReadonlyMap<string, string>;
    schoolNames: ReadonlyMap<string, string>;
}

export interface TeachSharedRowContext {
    ownerName: string;
}

type TeachContainerDoc = Tdoc | TrainingDoc;

function invalid(field: string, detail: ReturnType<typeof localizedErrorText>): never {
    throw new ValidationError(field, null, detail);
}

function readObjectId(value: unknown, field: string): ObjectId {
    if (!(value instanceof ObjectId)) invalid(field, localizedErrorText`题目集编号无效。`);
    return value;
}

function readOwner(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        invalid('owner', localizedErrorText`题目集的所有者无效。`);
    }
    return value;
}

function readMaintainers(value: unknown): number[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) invalid('maintainer', localizedErrorText`题目集的维护者无效。`);
    for (const uid of value) {
        if (typeof uid !== 'number' || !Number.isSafeInteger(uid)) {
            invalid('maintainer', localizedErrorText`题目集的维护者无效。`);
        }
    }
    return value as number[];
}

function readTitle(value: unknown): string {
    if (typeof value !== 'string') invalid('title', localizedErrorText`题目集标题无效。`);
    return value;
}

function readDate(value: unknown, field: string): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'string' && value) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    invalid(field, localizedErrorText`题目集的时间无效。`);
}

/** Contest `duration` is stored in hours. The list payload is minutes. */
function durationMinutesOf(raw: unknown): number | null {
    if (raw === undefined || raw === null || raw === 0) return null;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
        invalid('duration', localizedErrorText`个人限时无效。`);
    }
    const minutes = raw * 60;
    const rounded = Math.round(minutes);
    if (!Number.isSafeInteger(rounded) || rounded < 1 || Math.abs(minutes - rounded) > 1e-6) {
        invalid('duration', localizedErrorText`个人限时无效。`);
    }
    return rounded;
}

function readCountList(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) invalid(field, localizedErrorText`题目列表无效。`);
    return value;
}

function readSharedAt(raw: unknown): string | null {
    let shared: ReturnType<typeof readSchoolShared>;
    try {
        shared = readSchoolShared(raw);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'teach_school_shared_invalid') {
            invalid('schoolShared', localizedErrorText`题目集的学校共享数据无效。`);
        }
        throw error;
    }
    return shared ? shared.sharedAt.toISOString() : null;
}

function drawCountOf(rule: string, raw: unknown): number | null {
    if (rule !== 'exam') return null;
    try {
        const quotas = readExamPaperQuotas(raw);
        return quotas === null ? null : examPaperQuotaTotal(quotas);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'exam_paper_quotas_invalid') {
            invalid('examPaperQuotas', localizedErrorText`抽题设置无效。`);
        }
        throw error;
    }
}

function hexIdentity(value: unknown): string | null {
    if (value instanceof ObjectId) return value.toHexString();
    if (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value) && new ObjectId(value).toHexString() === value.toLowerCase()) {
        return value.toLowerCase();
    }
    return null;
}

function emptySelection(noun: '用户组' | '学校'): string {
    return noun === '用户组' ? '未选择用户组' : '未选择学校';
}

function deletedLabel(noun: '用户组' | '学校'): string {
    return noun === '用户组' ? '已删除的用户组' : '已删除的学校';
}

function summarizeNames(names: readonly string[], noun: '用户组' | '学校'): string {
    if (names.length === 0) return emptySelection(noun);
    if (names.length <= 3) return names.join('、');
    return `${names.slice(0, 3).join('、')} 等 ${names.length} 个${noun}`;
}

function namesOf(raw: unknown, directory: ReadonlyMap<string, string>, noun: '用户组' | '学校'): string {
    if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return emptySelection(noun);
    if (!Array.isArray(raw)) return AUDIENCE_UNREADABLE;
    const missing = deletedLabel(noun);
    return summarizeNames(raw.map((id) => {
        const hex = hexIdentity(id);
        if (!hex) return missing;
        return directory.get(hex) ?? missing;
    }), noun);
}

function contestAudience(doc: Tdoc, groups: ReadonlyMap<string, string>, schools: ReadonlyMap<string, string>): string {
    // Missing mode is the historical contest default, not a backfill.
    const mode = doc.participantScopeMode === undefined ? 'none' : doc.participantScopeMode;
    if (mode === 'none') return '所有人';
    if (mode === 'groups') return namesOf(doc.participantGroupIds, groups, '用户组');
    if (mode === 'schools') return namesOf(doc.participantSchoolIds, schools, '学校');
    return AUDIENCE_UNREADABLE;
}

function practiceAudience(doc: TrainingDoc, groups: ReadonlyMap<string, string>): string {
    let audience: { public: boolean; groupIds: string[] };
    try {
        audience = problemSetAudienceOf(doc);
    } catch (error) {
        if (error instanceof TypeError) return AUDIENCE_UNREADABLE;
        throw error;
    }
    if (audience.public) return '所有人';
    if (audience.groupIds.length === 0) return '仅兑换码';
    const missing = deletedLabel('用户组');
    return summarizeNames(audience.groupIds.map((id) => groups.get(id) ?? missing), '用户组');
}

function audienceText(doc: TeachContainerDoc, type: TeachType, groups: ReadonlyMap<string, string>, schools: ReadonlyMap<string, string>, id: string): string {
    try {
        return type === 'practice'
            ? practiceAudience(doc as TrainingDoc, groups)
            : contestAudience(doc as Tdoc, groups, schools);
    } catch (error) {
        if (!(error instanceof ValidationError) && !(error instanceof TypeError)) throw error;
        logger.error('teach list audience failed id=%s name=%s', id, error.name);
        return AUDIENCE_UNREADABLE;
    }
}

function practiceShape(doc: TrainingDoc): { problemCount: number; stageCount: number } {
    if (!isProblemSetKind(doc.kind)) invalid('kind', localizedErrorText`题目集类型无效。`);
    if (!Array.isArray(doc.dag)) invalid('dag', localizedErrorText`练习阶段数据无效。`);
    let problemCount = 0;
    for (const node of doc.dag) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) invalid('dag', localizedErrorText`练习阶段数据无效。`);
        problemCount += readCountList(node.pids, 'pids').length;
    }
    return { problemCount, stageCount: doc.dag.length };
}

function contestTypeOf(rule: unknown): TeachType {
    try {
        return teachTypeOfContestRule(rule);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'teach_rule_unsupported') {
            invalid('rule', localizedErrorText`题目集类型无效。`);
        }
        throw error;
    }
}

function readParticipantCount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        invalid('participantCount', localizedErrorText`人数统计无效。`);
    }
    return value;
}

interface ContainerFacts {
    type: TeachType;
    id: string;
    rule: string;
    title: string;
    beginAt: string | null;
    endAt: string | null;
    durationMinutes: number | null;
    problemCount: number;
    drawCount: number | null;
    stageCount: number | null;
    owner: number;
    createdAt: string;
    sharedAt: string | null;
    status: TeachStatus;
    audienceDoc: TeachContainerDoc;
}

function describeContainer(doc: TeachContainerDoc, now: Date): ContainerFacts {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('teach_window_invalid');
    const id = readObjectId(doc.docId, 'docId').toHexString();
    const createdAt = readObjectId(doc._id, '_id').getTimestamp().toISOString();
    const owner = readOwner(doc.owner);
    readMaintainers(doc.maintainer);
    const title = readTitle(doc.title);
    const sharedAt = readSharedAt(doc.schoolShared);
    if (doc.docType === TYPE_TRAINING) {
        const shape = practiceShape(doc);
        return {
            type: 'practice',
            id,
            rule: 'problem_set',
            title,
            beginAt: null,
            endAt: null,
            durationMinutes: null,
            problemCount: shape.problemCount,
            drawCount: null,
            stageCount: shape.stageCount,
            owner,
            createdAt,
            sharedAt,
            status: teachStatusOf({ type: 'practice' }, now),
            audienceDoc: doc,
        };
    }
    if (doc.docType !== TYPE_CONTEST) invalid('docType', localizedErrorText`题目集类型无效。`);
    const type = contestTypeOf(doc.rule);
    const beginAt = readDate(doc.beginAt, 'beginAt');
    const endAt = readDate(doc.endAt, 'endAt');
    return {
        type,
        id,
        rule: doc.rule,
        title,
        beginAt: beginAt.toISOString(),
        endAt: endAt.toISOString(),
        durationMinutes: durationMinutesOf(doc.duration),
        problemCount: readCountList(doc.pids, 'pids').length,
        drawCount: drawCountOf(doc.rule, doc.examPaperQuotas),
        stageCount: null,
        owner,
        createdAt,
        sharedAt,
        status: teachStatusOf({ type, beginAt, endAt }, now),
        audienceDoc: doc,
    };
}

export function teachListRow(doc: TeachContainerDoc, ctx: TeachListRowContext): TeachListRow {
    const facts = describeContainer(doc, ctx.now);
    const audience = audienceText(facts.audienceDoc, facts.type, ctx.groupNames, ctx.schoolNames, facts.id);
    return {
        type: facts.type,
        id: facts.id,
        rule: facts.rule,
        title: facts.title,
        status: facts.status,
        beginAt: facts.beginAt,
        endAt: facts.endAt,
        durationMinutes: facts.durationMinutes,
        audience,
        problemCount: facts.problemCount,
        drawCount: facts.drawCount,
        stageCount: facts.stageCount,
        participantCount: readParticipantCount(ctx.participantCount),
        role: teachRoleOf(ctx.actor, doc),
        shared: facts.sharedAt !== null,
        createdAt: facts.createdAt,
    };
}

export function teachSharedRow(doc: TeachContainerDoc, ctx: TeachSharedRowContext): TeachSharedRow {
    if (typeof ctx.ownerName !== 'string' || !ctx.ownerName) invalid('owner', localizedErrorText`题目集的所有者不存在。`);
    const facts = describeContainer(doc, new Date());
    if (facts.sharedAt === null) invalid('schoolShared', localizedErrorText`题目集的学校共享数据无效。`);
    return {
        type: facts.type,
        id: facts.id,
        rule: facts.rule,
        title: facts.title,
        ownerUid: facts.owner,
        ownerName: ctx.ownerName,
        problemCount: facts.problemCount,
        drawCount: facts.drawCount,
        beginAt: facts.beginAt,
        endAt: facts.endAt,
        durationMinutes: facts.durationMinutes,
        sharedAt: facts.sharedAt,
    };
}
