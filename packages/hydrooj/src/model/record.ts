import { pick, sum } from 'lodash';
import moment from 'moment-timezone';
import { Filter, FindOptions, MatchKeysAndValues, ObjectId, OnlyFieldsOfType, PushOperator, UpdateFilter } from 'mongodb';
import { effectiveProblemKind, ProblemConfigFile, STATUS_TEXTS } from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import { Context } from '../context';
import { localizedErrorText, ProblemConfigError, ProblemNotFoundError, ValidationError } from '../error';
import { JudgeMeta, ProblemDataWriteConfirmation, RecordDoc } from '../interface';
import {
    parseProblemConfigObject,
    parseStructuredRegionSubmission,
    validateCompiledStructuredConfig,
    validateStructuredCodeJudgeConfig,
} from '../lib/problem-config';
import db from '../service/db';
import { MaybeArray, NumberKeys } from '../typeutils';
import { ArgMethod, buildProjection, Time } from '../utils';
import { STATUS } from './builtin';
import DomainModel from './domain';
import MessageModel from './message';
import problem from './problem';
import SystemModel from './system';
import task from './task';

const logger = new Logger('record');

export default class RecordModel {
    static coll = db.collection('record');
    static collStat = db.collection('record.stat');
    static collHistory = db.collection('record.history');
    static PROJECTION_LIST: (keyof RecordDoc)[] = [
        '_id',
        'score',
        'time',
        'memory',
        'lang',
        'uid',
        'pid',
        'rejudged',
        'progress',
        'domainId',
        'contest',
        'contestTeamId',
        'judger',
        'judgeAt',
        'status',
        'source',
        'files',
        'hackTarget',
        'scoreCancellation',
    ];

    static STAT_QUERY = {
        time: [{ time: -1 }, { time: 1 }],
        memory: [{ memory: -1 }, { memory: 1 }],
        length: [{ length: -1 }, { length: 1 }],
        date: [{ _id: -1 }, { _id: 1 }],
    };

    static RECORD_PRETEST = new ObjectId('000000000000000000000000');
    static RECORD_GENERATE = new ObjectId('000000000000000000000001');

    static async submissionPriority(uid: number, base: number = 0) {
        const timeRecent = await RecordModel.coll
            .find({ _id: { $gte: Time.getObjectID(moment().add(-30, 'minutes')) }, uid, rejudged: { $ne: true } })
            .project({ time: 1, status: 1, manualPending: 1 })
            .toArray();
        const pending = timeRecent.filter(
            (i) =>
                [STATUS.STATUS_WAITING, STATUS.STATUS_FETCHED, STATUS.STATUS_COMPILING, STATUS.STATUS_JUDGING].includes(i.status) && !i.manualPending,
        ).length;
        return Math.max(base - 10000, base - (pending * 1000 + 1) * (sum(timeRecent.map((i) => i.time || 0)) / 10000 + 1));
    }

    static async get(_id: ObjectId): Promise<RecordDoc | null>;
    static async get(domainId: string, _id: ObjectId): Promise<RecordDoc | null>;
    static async get(arg0: string | ObjectId, arg1?: any) {
        const _id = arg1 || arg0;
        const domainId = arg1 ? arg0 : null;
        const res = await RecordModel.coll.findOne({ _id });
        if (!res) return null;
        if (res.domainId === (domainId || res.domainId)) return res;
        return null;
    }

    @ArgMethod
    static async stat(domainId?: string, tid?: ObjectId) {
        // Optional contest scope (PLAN 2026-07-02 §8): same window shape so
        // the ui-next statistics card renders both scopes unchanged.
        const scope = { ...(domainId ? { domainId } : {}), ...(tid ? { contest: tid } : {}) };
        const [d5min, d1h, day, week, month, year, total] = await Promise.all([
            RecordModel.coll.countDocuments({ _id: { $gte: Time.getObjectID(moment().add(-5, 'minutes')) }, ...scope }),
            RecordModel.coll.countDocuments({ _id: { $gte: Time.getObjectID(moment().add(-1, 'hour')) }, ...scope }),
            RecordModel.coll.countDocuments({ _id: { $gte: Time.getObjectID(moment().add(-1, 'day')) }, ...scope }),
            RecordModel.coll.countDocuments({ _id: { $gte: Time.getObjectID(moment().add(-1, 'week')) }, ...scope }),
            RecordModel.coll.countDocuments({ _id: { $gte: Time.getObjectID(moment().add(-1, 'month')) }, ...scope }),
            RecordModel.coll.countDocuments({ _id: { $gte: Time.getObjectID(moment().add(-1, 'year')) }, ...scope }),
            domainId || tid ? RecordModel.coll.countDocuments(scope) : RecordModel.coll.estimatedDocumentCount(),
        ]);
        if (!tid) return { d5min, d1h, day, week, month, year, total };
        const [accepted, participants] = await Promise.all([
            RecordModel.coll.countDocuments({ ...scope, status: STATUS.STATUS_ACCEPTED }),
            RecordModel.coll.distinct('uid', scope).then((u) => u.length),
        ]);
        return {
            d5min,
            d1h,
            day,
            week,
            month,
            year,
            total,
            accepted,
            participants,
        };
    }

    private static async preflightJudgeRecords(domainId: string, rdocs: RecordDoc[], meta: Partial<JudgeMeta> = {}) {
        if (rdocs.some((rdoc) => rdoc.manualPending || rdoc.manualGrade)) {
            throw new ValidationError('rid', null, localizedErrorText`人工阅卷记录不能进入自动评测队列`);
        }
        const byProblem = new Map<number, RecordDoc[]>();
        for (const rdoc of rdocs) {
            if (rdoc.domainId !== domainId) throw new ValidationError('rid');
            const group = byProblem.get(rdoc.pid) || [];
            group.push(rdoc);
            byProblem.set(rdoc.pid, group);
        }
        const contexts = [];
        for (const group of byProblem.values()) {
            let source = `${domainId}/${group[0].pid}`;
            let pdoc = await problem.get(domainId, group[0].pid, undefined, true);
            if (!pdoc) throw new ProblemNotFoundError(domainId, group[0].pid);
            if (pdoc.reference) {
                pdoc = await problem.get(pdoc.reference.domainId, pdoc.reference.pid, undefined, true);
                if (!pdoc) throw new ProblemNotFoundError(domainId, group[0].pid);
                source = `${pdoc.domainId}/${pdoc.docId}`;
            }
            problem.assertProblemReadyForUse(pdoc, { actor: group[0].uid, stage: 'judge-queue' });
            const judgeConfig =
                parseProblemConfigObject(pdoc) ?? (pdoc.config == null || (typeof pdoc.config === 'string' && !pdoc.config.trim()) ? {} : null);
            if (!judgeConfig) throw new ProblemConfigError();
            const problemKind = effectiveProblemKind(pdoc);
            try {
                if (['program_fill', 'function'].includes(judgeConfig.type)) {
                    validateStructuredCodeJudgeConfig(judgeConfig, problemKind as 'program_fill' | 'function');
                }
                validateCompiledStructuredConfig(problemKind, judgeConfig);
                if (
                    meta?.type !== 'generate' &&
                    ['program_fill', 'function'].includes(judgeConfig.type) &&
                    ['program_fill', 'function'].includes(problemKind)
                ) {
                    for (const rdoc of group) {
                        parseStructuredRegionSubmission(problemKind as 'program_fill' | 'function', judgeConfig.template, rdoc.code);
                        const expectedLang = problemKind === 'program_fill' && judgeConfig.mode === 'text' ? '_' : judgeConfig.template?.lang;
                        if (rdoc.lang !== expectedLang) throw new Error(`${problemKind}: submission language mismatch`);
                    }
                }
            } catch (error) {
                logger.error(
                    'Structured judge preflight rejected domain=%s pid=%d kind=%s revision=%s rids=%s stage=before-task-delete error=%o',
                    pdoc.domainId,
                    pdoc.docId,
                    problemKind,
                    pdoc.structureRevision,
                    group.map((rdoc) => rdoc._id).join(','),
                    error,
                );
                if (error instanceof ValidationError) throw error;
                throw new ValidationError('rid', null, localizedErrorText`当前题目配置或提交结构无法重新评测`);
            }
            contexts.push({ rdocs: group, pdoc, source, judgeConfig });
        }
        return contexts;
    }

    static async assertRejudgeable(domainId: string, rdocs: RecordDoc[]) {
        await RecordModel.preflightJudgeRecords(domainId, rdocs, { rejudge: true });
    }

    static async judge(
        domainId: string,
        rids: MaybeArray<ObjectId> | RecordDoc,
        priority = 0,
        config: ProblemConfigFile = {},
        meta: Partial<JudgeMeta> = {},
    ) {
        let rdocs: RecordDoc[];
        const _rids = rids instanceof Array ? rids : rids instanceof ObjectId ? [rids] : [rids._id];
        if (!_rids.length) return null;
        if (rids instanceof Array || rids instanceof ObjectId || ObjectId.isValid(rids.toString())) {
            rdocs = await RecordModel.getMulti(domainId, { _id: { $in: _rids } }, { readPreference: 'primary' }).toArray();
        } else rdocs = [rids];
        if (!rdocs.length) return null;
        const contexts = await RecordModel.preflightJudgeRecords(domainId, rdocs, meta);
        const insertedIds: Record<number, ObjectId> = {};
        let insertedIndex = 0;
        for (const { rdocs: group, pdoc, source, judgeConfig } of contexts) {
            await task.deleteMany({ rid: { $in: group.map((rdoc) => rdoc._id) } });
            const taskMeta = { ...meta, problemOwner: pdoc.owner };
            const ddoc = await DomainModel.get(pdoc.domainId);
            const inserted = await task.addMany(
                group.map((rdoc) => {
                    let type = 'judge';
                    if (judgeConfig.type === 'remote_judge' && rdoc.contest?.toHexString() !== '0'.repeat(24)) type = 'remotejudge';
                    else if (taskMeta?.type === 'generate') type = 'generate';
                    return {
                        ...rdoc,
                        ...judgeConfig, // TODO deprecate this
                        priority,
                        type,
                        rid: rdoc._id,
                        domainId,
                        config: {
                            ...judgeConfig,
                            ...config,
                        },
                        data: pdoc.data,
                        source,
                        trusted: ddoc.isTrusted,
                        meta: taskMeta,
                    } as any;
                }),
            );
            for (const id of Object.values(inserted)) insertedIds[insertedIndex++] = id;
        }
        return insertedIds;
    }

    static async add(
        domainId: string,
        pid: number,
        uid: number,
        lang: string,
        code: string,
        addTask: boolean,
        args: {
            contest?: ObjectId;
            /** Original contest context for pretests, whose `contest` field is replaced by the pretest sentinel. */
            contestContext?: ObjectId;
            input?: string[];
            files?: Record<string, string>;
            hackTarget?: ObjectId;
            type: 'judge' | 'rejudge' | 'pretest' | 'hack' | 'generate' | 'manual';
            notify?: boolean;
            /** Hydro session key for the authoritative Vigil team-session gate. */
            vigilSessionKey?: string;
            dataWriteActiveContainerConfirmation?: ProblemDataWriteConfirmation;
        } = { type: 'judge' },
    ) {
        const data: RecordDoc = {
            status: STATUS.STATUS_WAITING,
            _id: new ObjectId(),
            uid,
            code,
            lang,
            pid,
            domainId,
            score: 0,
            time: 0,
            memory: 0,
            judgeTexts: [],
            compilerTexts: [],
            testCases: [],
            judger: null,
            judgeAt: null,
            rejudged: false,
        };
        const contestContext = args.contestContext || args.contest;
        let isContest = !!args.contest;
        if (args.contest) data.contest = args.contest;
        if (args.files) data.files = args.files;
        if (args.hackTarget) data.hackTarget = args.hackTarget;
        if (args.notify) data.notify = true;
        if (args.dataWriteActiveContainerConfirmation) {
            data.dataWriteActiveContainerConfirmation = { ...args.dataWriteActiveContainerConfirmation };
        }
        if (args.type === 'manual') {
            if (!args.contest) throw new ValidationError('contest');
            data.lang = '_';
            data.manualPending = true;
            data.judgeAt = new Date();
            addTask = false;
        } else if (args.type === 'rejudge') {
            args.type = 'judge';
            data.rejudged = true;
        } else if (args.type === 'pretest') {
            data.input = args.input || [];
            isContest = false;
            data.contest = RecordModel.RECORD_PRETEST;
        } else if (args.type === 'generate') {
            data.contest = RecordModel.RECORD_GENERATE;
        }
        const currentProblem = await problem.claimStructureLockForSubmission(domainId, pid, args.type !== 'generate', uid);
        const currentConfig = parseProblemConfigObject(currentProblem);
        const currentKind = effectiveProblemKind(currentProblem);
        if (
            args.type !== 'generate' &&
            ['program_fill', 'function'].includes(currentConfig?.type) &&
            ['program_fill', 'function'].includes(currentKind)
        ) {
            try {
                const lengthLimit = SystemModel.get('limit.codelength') || 128 * 1024;
                if (code.length > lengthLimit) throw new ValidationError('code');
                validateStructuredCodeJudgeConfig(currentConfig, currentKind as 'program_fill' | 'function');
                validateCompiledStructuredConfig(currentKind, currentConfig);
                parseStructuredRegionSubmission(currentKind as 'program_fill' | 'function', currentConfig.template, code);
                const expectedLang = currentKind === 'program_fill' && currentConfig.mode === 'text' ? '_' : currentConfig.template.lang;
                if (lang !== expectedLang) throw new Error(`${currentKind}: submission language mismatch`);
            } catch (error) {
                logger.error(
                    'Structured record creation rejected domain=%s pid=%d source=%s/%d kind=%s revision=%s uid=%d stage=before-insert error=%o',
                    domainId,
                    pid,
                    currentProblem.domainId,
                    currentProblem.docId,
                    currentKind,
                    currentProblem.structureRevision,
                    uid,
                    error,
                );
                throw error;
            }
        }
        if (contestContext && ![RecordModel.RECORD_PRETEST, RecordModel.RECORD_GENERATE].some((sentinel) => sentinel.equals(contestContext))) {
            const resolver = global.Hydro?.model?.contest?.resolveTeamSubmissionCapability;
            if (typeof resolver !== 'function') throw new Error('Contest submission capability resolver is unavailable.');
            const capability = await resolver(domainId, contestContext, uid, { vigilSessionKey: args.vigilSessionKey });
            if (capability.mode === 'team') {
                if (!(capability.teamId instanceof ObjectId)) throw new ValidationError('contestTeamId');
                data.contestTeamId = capability.teamId;
            }
        }
        let res;
        try {
            res = await RecordModel.coll.insertOne(data);
        } catch (error) {
            logger.error(
                'Record insert failed after conservative structure lock domain=%s pid=%d uid=%d rid=%s error=%o',
                domainId,
                pid,
                uid,
                data._id,
                error,
            );
            throw error;
        }
        bus.broadcast('record/change', data);
        if (addTask) {
            const priority = await RecordModel.submissionPriority(uid, args.type === 'pretest' ? -20 : isContest ? 50 : 0);
            await RecordModel.judge(domainId, data, priority, isContest ? { detail: false } : {}, {
                type: args.type,
                rejudge: data.rejudged,
            });
        }
        return res.insertedId;
    }

    static getMulti(domainId: string, query: any, options?: FindOptions) {
        if (domainId) query = { domainId, ...query };
        return RecordModel.coll.find(query, options);
    }

    static getMultiStat(domainId: string, query: any, sortBy: any = { _id: -1 }) {
        return RecordModel.collStat.find({ domainId, ...query }).sort(sortBy);
    }

    static async update(
        domainId: string,
        _id: MaybeArray<ObjectId>,
        $set?: MatchKeysAndValues<RecordDoc>,
        $push?: PushOperator<RecordDoc>,
        $unset?: OnlyFieldsOfType<RecordDoc, any, true | '' | 1>,
        $inc?: Partial<Record<NumberKeys<RecordDoc>, number>>,
    ): Promise<RecordDoc | null> {
        const $update: UpdateFilter<RecordDoc> = {};
        if ($set && Object.keys($set).length) $update.$set = $set;
        if ($push && Object.keys($push).length) $update.$push = $push;
        if ($unset && Object.keys($unset).length) $update.$unset = $unset;
        if ($inc && Object.keys($inc).length) $update.$inc = $inc;
        if (_id instanceof Array) {
            await RecordModel.coll.updateMany({ _id: { $in: _id }, domainId }, $update);
            return null;
        }
        if (Object.keys($update).length) {
            return await RecordModel.coll.findOneAndUpdate({ _id, domainId }, $update, { returnDocument: 'after' });
        }
        return await RecordModel.coll.findOne({ _id }, { readPreference: 'primary' });
    }

    static async updateMulti(
        domainId: string,
        $match: Filter<RecordDoc>,
        $set?: MatchKeysAndValues<RecordDoc>,
        $push?: PushOperator<RecordDoc>,
        $unset?: OnlyFieldsOfType<RecordDoc, any, true | '' | 1>,
    ) {
        const $update: UpdateFilter<RecordDoc> = {};
        if ($set && Object.keys($set).length) $update.$set = $set;
        if ($push && Object.keys($push).length) $update.$push = $push;
        if ($unset && Object.keys($unset).length) $update.$unset = $unset;
        const res = await RecordModel.coll.updateMany({ domainId, ...$match }, $update);
        return res.modifiedCount;
    }

    static async reset(domainId: string, rid: MaybeArray<ObjectId>, isRejudge: boolean) {
        const rids = Array.isArray(rid) ? rid : [rid];
        if (isRejudge) {
            const rdocs = await RecordModel.coll.find({ domainId, _id: { $in: rids } }, { readPreference: 'primary' }).toArray();
            await RecordModel.preflightJudgeRecords(domainId, rdocs, { rejudge: true });
        }
        const manual = await RecordModel.coll.findOne(
            {
                _id: { $in: rids },
                $or: [{ manualPending: true }, { manualGrade: { $exists: true } }],
            },
            { projection: { _id: 1 } },
        );
        if (manual) throw new ValidationError('rid', null, localizedErrorText`人工阅卷记录不能重判`);
        const upd: any = {
            score: 0,
            status: STATUS.STATUS_WAITING,
            time: 0,
            memory: 0,
            testCases: [],
            subtasks: {},
            judgeTexts: [],
            compilerTexts: [],
            judgeAt: null,
            judger: null,
        };
        if (isRejudge) upd.rejudged = true;
        const [rdocs] = await Promise.all([
            RecordModel.coll.find({ _id: { $in: rids }, judgeAt: { $exists: true, $ne: null } }).toArray(),
            RecordModel.collStat.deleteMany({ _id: { $in: rids } }),
            task.deleteMany({ rid: { $in: rids } }),
        ]);
        if (rdocs.length) {
            await RecordModel.collHistory.insertMany(
                rdocs.map((rdoc) => ({
                    ...pick(rdoc, [
                        'compilerTexts',
                        'judgeTexts',
                        'testCases',
                        'subtasks',
                        'score',
                        'time',
                        'memory',
                        'status',
                        'judgeAt',
                        'judger',
                        'scoreCancellation',
                    ]),
                    rid: rdoc._id,
                    _id: new ObjectId(),
                })),
            );
        }
        return RecordModel.update(domainId, rid, upd, undefined, isRejudge ? { scoreCancellation: '' } : undefined);
    }

    static async resetCanceledScore(domainId: string, rid: ObjectId, expectedCancellationAt: Date) {
        const current = await RecordModel.coll.findOne(
            {
                _id: rid,
                domainId,
                status: STATUS.STATUS_CANCELED,
                'scoreCancellation.at': expectedCancellationAt,
            },
            { readPreference: 'primary' },
        );
        if (!current) throw new ValidationError('record', null, localizedErrorText`提交状态已变化，请刷新后重试`);
        await RecordModel.preflightJudgeRecords(domainId, [current], { rejudge: true });
        const updated = await RecordModel.coll.findOneAndUpdate(
            {
                _id: rid,
                domainId,
                status: STATUS.STATUS_CANCELED,
                'scoreCancellation.at': expectedCancellationAt,
            },
            {
                $set: {
                    score: 0,
                    status: STATUS.STATUS_WAITING,
                    time: 0,
                    memory: 0,
                    testCases: [],
                    subtasks: {},
                    judgeTexts: [],
                    compilerTexts: [],
                    judgeAt: null,
                    judger: null,
                    rejudged: true,
                },
                $unset: {
                    progress: '',
                },
            },
            { returnDocument: 'after' },
        );
        if (!updated) throw new ValidationError('record', null, localizedErrorText`提交状态已变化，请刷新后重试`);
        await Promise.all([RecordModel.collStat.deleteMany({ _id: rid }), task.deleteMany({ rid })]);
        return updated;
    }

    static async finalizeCanceledScoreRecovery(
        domainId: string,
        rid: ObjectId,
        expectedCancellationAt: Date,
        historyId: ObjectId,
        canceled: RecordDoc,
    ) {
        await RecordModel.collHistory.updateOne(
            { _id: historyId },
            {
                $setOnInsert: {
                    ...pick(canceled, [
                        'compilerTexts',
                        'judgeTexts',
                        'testCases',
                        'subtasks',
                        'score',
                        'time',
                        'memory',
                        'status',
                        'judgeAt',
                        'judger',
                        'scoreCancellation',
                    ]),
                    rid: canceled._id,
                },
            },
            { upsert: true },
        );
        const updated = await RecordModel.coll.findOneAndUpdate(
            {
                _id: rid,
                domainId,
                'scoreCancellation.at': expectedCancellationAt,
            },
            { $unset: { scoreCancellation: '' } },
            { returnDocument: 'after' },
        );
        if (!updated) throw new ValidationError('record', null, localizedErrorText`恢复状态已变化，请刷新后重试`);
        return updated;
    }

    static async rollbackCanceledScoreRecovery(domainId: string, waiting: RecordDoc, canceled: RecordDoc) {
        const cancellationAt = canceled.scoreCancellation?.at;
        if (!(cancellationAt instanceof Date)) throw new ValidationError('record');
        const restored = await RecordModel.coll.findOneAndUpdate(
            {
                _id: waiting._id,
                domainId,
                status: STATUS.STATUS_WAITING,
                judgeAt: null,
                'scoreCancellation.at': cancellationAt,
            },
            {
                $set: {
                    status: STATUS.STATUS_CANCELED,
                    score: canceled.score,
                    time: canceled.time,
                    memory: canceled.memory,
                    testCases: canceled.testCases || [],
                    subtasks: canceled.subtasks || {},
                    judgeTexts: canceled.judgeTexts || [],
                    compilerTexts: canceled.compilerTexts || [],
                    judgeAt: canceled.judgeAt,
                    judger: canceled.judger,
                    scoreCancellation: canceled.scoreCancellation,
                    ...(canceled.rejudged === undefined ? {} : { rejudged: canceled.rejudged }),
                },
                ...(canceled.rejudged === undefined ? { $unset: { rejudged: '' } } : {}),
            },
            { returnDocument: 'after' },
        );
        if (!restored) throw new Error(`Canceled score recovery rollback CAS failed domain=${domainId} rid=${waiting._id.toHexString()}`);
        await task.deleteMany({ rid: waiting._id });
        return restored;
    }

    static count(domainId: string, query: any) {
        return RecordModel.coll.countDocuments({ domainId, ...query });
    }

    static async getList(domainId: string, rids: ObjectId[], fields?: (keyof RecordDoc)[]): Promise<Record<string, Partial<RecordDoc>>> {
        const r: Record<string, RecordDoc> = {};
        rids = Array.from(new Set(rids));
        let cursor = RecordModel.coll.find({ domainId, _id: { $in: rids } });
        if (fields) cursor = cursor.project(buildProjection(fields));
        const rdocs = await cursor.toArray();
        for (const rdoc of rdocs) r[rdoc._id.toHexString()] = rdoc;
        return r;
    }
}

export async function apply(ctx: Context) {
    // Mark problem as deleted
    ctx.on('problem/delete', (domainId, docId) =>
        Promise.all([RecordModel.coll.deleteMany({ domainId, pid: docId }), RecordModel.collStat.deleteMany({ domainId, pid: docId })]),
    );
    ctx.on('domain/delete', (domainId) => RecordModel.coll.deleteMany({ domainId }));
    ctx.on('record/judge', async (rdoc, updated) => {
        if (rdoc.contest?.toHexString().startsWith('0'.repeat(23))) return;
        if (rdoc.notify) {
            const pdoc = await Hydro.model.problem.get(rdoc.domainId, rdoc.pid);
            await MessageModel.send(
                1,
                rdoc.uid,
                JSON.stringify({
                    message: 'Judge Result\n{0}: {1}',
                    params: [pdoc.title, STATUS_TEXTS[rdoc.status]],
                }),
                MessageModel.FLAG_I18N,
            );
        }
        if (rdoc.status === STATUS.STATUS_ACCEPTED && updated) {
            if (SystemModel.get('record.statMode') === 'unique') {
                await RecordModel.collStat.deleteMany({
                    _id: { $ne: rdoc._id },
                    uid: rdoc.uid,
                    pid: rdoc.pid,
                    domainId: rdoc.domainId,
                });
            }
            await RecordModel.collStat.updateOne(
                {
                    _id: rdoc._id,
                },
                {
                    $set: {
                        domainId: rdoc.domainId,
                        pid: rdoc.pid,
                        uid: rdoc.uid,
                        time: rdoc.time,
                        memory: rdoc.memory,
                        length: rdoc.code?.length || 0,
                        lang: rdoc.lang,
                    },
                },
                { upsert: true },
            );
        }
    });
    await Promise.all([
        db.ensureIndexes(
            RecordModel.coll,
            { key: { domainId: 1, pid: 1 }, name: 'delete' },
            { key: { domainId: 1, contest: 1, _id: -1 }, name: 'basic' },
            { key: { domainId: 1, contest: 1, uid: 1, _id: -1 }, name: 'withUser' },
            { key: { domainId: 1, contest: 1, pid: 1, _id: -1 }, name: 'withProblem' },
            { key: { domainId: 1, contest: 1, pid: 1, uid: 1, _id: -1 }, name: 'withUserAndProblem' },
            { key: { domainId: 1, contest: 1, status: 1, _id: -1 }, name: 'withStatus' },
        ),
        db.ensureIndexes(
            RecordModel.collStat,
            { key: { domainId: 1, pid: 1, uid: 1, _id: -1 }, name: 'basic' },
            { key: { domainId: 1, pid: 1, uid: 1, time: 1 }, name: 'time' },
            { key: { domainId: 1, pid: 1, uid: 1, memory: 1 }, name: 'memory' },
            { key: { domainId: 1, pid: 1, uid: 1, length: 1 }, name: 'length' },
        ),
        db.ensureIndexes(RecordModel.collHistory, { key: { rid: 1, _id: -1 }, name: 'basic' }),
    ]);
}
global.Hydro.model.record = RecordModel;
