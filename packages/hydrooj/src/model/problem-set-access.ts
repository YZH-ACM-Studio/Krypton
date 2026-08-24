import { Collection, Filter, ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { localizedErrorText, NotFoundError, TrainingNotFoundError, ValidationError } from '../error';
import type { TrainingDoc } from '../interface';
import { Context } from '../context';
import db from '../service/db';
import { courseKindClause, isProblemSetKind } from '../lib/training-kind';
import { canonicalProblemSetAudience, isLegacyPublicProblemSet, problemSetAudienceOf } from '../lib/problem-set-audience';
import { computePrerequisiteClosure, ProblemSetStageGraphError, prerequisitesCompleted, trainingNodeById } from '../lib/problem-set-stage';
import { PERM, PRIV } from './builtin';
import * as document from './document';
import { settleDomainCleanupOperations } from './domain-lifecycle-boundary';

const logger = new Logger('problem-set-access');

export type ProblemSetAccessSourceKind = 'public' | 'group' | 'course' | 'redemption' | 'manage';
export type AccessEntitlementTargetKind = 'problem_set' | 'problem_set_stage' | 'course';
export const ACCESS_ENTITLEMENT_WHOLE_SET_STAGE = 0;

export interface ProblemSetAccessSource {
    kind: ProblemSetAccessSourceKind;
    groupId?: string;
    courseId?: string;
    entitlementId?: string;
    stageId?: number;
}

export interface ProblemSetAccessDecision {
    discoverable: boolean;
    accessible: boolean;
    enrolled: boolean;
    sources: ProblemSetAccessSource[];
    stageAccess: 'all' | number[];
}

export interface AccessEntitlementDoc {
    _id: ObjectId;
    domainId: string;
    uid: number;
    targetKind: AccessEntitlementTargetKind;
    targetId: ObjectId;
    stageId: number;
    source: 'redemption';
    sourceId: ObjectId;
    createdAt: Date;
    revokedAt: Date | null;
}

export interface ProblemSetAccessUser {
    _id: number;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (priv: number) => boolean;
    own: (doc: { owner?: number }) => boolean;
}

type EntitlementCollection = Pick<Collection<AccessEntitlementDoc>, 'createIndex' | 'find' | 'findOne' | 'insertOne' | 'updateOne' | 'deleteMany'>;
type CourseCollection = Pick<Collection<TrainingDoc>, 'find'>;

export interface ProblemSetAccessServiceOptions {
    entitlements: EntitlementCollection;
    courses: CourseCollection;
    now?: () => Date;
    idFactory?: () => ObjectId;
    findStudentGroupIds?: (domainId: string, uid: number) => Promise<Set<string>>;
    getEnrollment?: (domainId: string, tid: ObjectId, uid: number) => Promise<{ enroll?: number } | null>;
}

function assertObjectId(value: ObjectId, field: string): ObjectId {
    if (!(value instanceof ObjectId)) throw new TypeError(`${field} must be an ObjectId`);
    return value;
}

export { canonicalProblemSetAudience, isLegacyPublicProblemSet, problemSetAudienceOf };

export function canManageProblemSet(user: ProblemSetAccessUser, tdoc: Pick<TrainingDoc, 'owner'>): boolean {
    if (user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return true;
    if (user.hasPerm(PERM.PERM_EDIT_TRAINING)) return true;
    return user.own(tdoc) && user.hasPerm(PERM.PERM_EDIT_TRAINING_SELF);
}

function courseVisibleTo(course: Pick<TrainingDoc, 'owner' | 'courseGroupIds'>, user: ProblemSetAccessUser, groupIds: Set<string>): boolean {
    if (user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || user.hasPerm(PERM.PERM_EDIT_COURSE) || user.own(course)) return true;
    const bound = course.courseGroupIds || [];
    if (!bound.length) return true;
    return bound.some((groupId) => groupIds.has(String(groupId)));
}

async function defaultFindStudentGroupIds(domainId: string, uid: number): Promise<Set<string>> {
    if (!uid || uid <= 1) return new Set();
    const findStudent = global.Hydro?.model?.userbind?.findStudentByUserId;
    if (typeof findStudent !== 'function') throw new TypeError('userbind.findStudentByUserId is unavailable');
    const student = await findStudent(domainId, uid);
    return new Set((student?.groupIds || []).map((groupId: ObjectId) => String(groupId)));
}

export class ProblemSetAccessService {
    private readonly entitlements: EntitlementCollection;
    private readonly courses: CourseCollection;
    private readonly now: () => Date;
    private readonly idFactory: () => ObjectId;
    private readonly findStudentGroupIds: (domainId: string, uid: number) => Promise<Set<string>>;
    private readonly getEnrollment: (domainId: string, tid: ObjectId, uid: number) => Promise<{ enroll?: number } | null>;
    private indexesPromise?: Promise<void>;

    constructor(options: ProblemSetAccessServiceOptions) {
        this.entitlements = options.entitlements;
        this.courses = options.courses;
        this.now = options.now || (() => new Date());
        this.idFactory = options.idFactory || (() => new ObjectId());
        this.findStudentGroupIds = options.findStudentGroupIds || defaultFindStudentGroupIds;
        this.getEnrollment =
            options.getEnrollment ||
            (async (domainId, tid, uid) => {
                const training = global.Hydro?.model?.training;
                if (typeof training?.getStatus !== 'function') throw new TypeError('training.getStatus is unavailable');
                return training.getStatus(domainId, tid, uid);
            });
    }

    async ensureIndexes(): Promise<void> {
        if (!this.indexesPromise) {
            this.indexesPromise = Promise.all([
                this.entitlements.createIndex(
                    { domainId: 1, uid: 1, targetKind: 1, targetId: 1, stageId: 1, source: 1, sourceId: 1 },
                    {
                        name: 'accessEntitlementActiveIdentity',
                        unique: true,
                        partialFilterExpression: { revokedAt: null },
                    },
                ),
                this.entitlements.createIndex({ domainId: 1, uid: 1, targetKind: 1, targetId: 1, revokedAt: 1 }, { name: 'accessEntitlementLookup' }),
            ])
                .then(() => undefined)
                .catch((error) => {
                    this.indexesPromise = undefined;
                    logger.error('Access entitlement index verification failed error=%o', error);
                    throw error;
                });
        }
        await this.indexesPromise;
    }

    async evaluate(domainId: string, user: ProblemSetAccessUser, tdoc: TrainingDoc): Promise<ProblemSetAccessDecision> {
        const map = await this.evaluateMany(domainId, user, [tdoc]);
        const decision = map.get(String(tdoc.docId));
        if (!decision) throw new TypeError('problem set access decision is missing');
        return decision;
    }

    async evaluateMany(
        domainId: string,
        user: ProblemSetAccessUser,
        tdocs: TrainingDoc[],
        enrollments?: ReadonlyMap<string, boolean>,
    ): Promise<Map<string, ProblemSetAccessDecision>> {
        await this.ensureIndexes();
        const result = new Map<string, ProblemSetAccessDecision>();
        if (!tdocs.length) return result;
        if (
            !user.hasPerm(PERM.PERM_VIEW_TRAINING) &&
            !user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) &&
            !tdocs.some((tdoc) => canManageProblemSet(user, tdoc))
        ) {
            for (const tdoc of tdocs) {
                result.set(String(tdoc.docId), { discoverable: false, accessible: false, enrolled: false, sources: [], stageAccess: [] });
            }
            return result;
        }
        const groupIds = await this.findStudentGroupIds(domainId, user._id);
        const [entitlements, courseEntitlements, courses] = await Promise.all([
            this.entitlements
                .find({
                    domainId,
                    uid: user._id,
                    targetKind: { $in: ['problem_set', 'problem_set_stage'] },
                    targetId: { $in: tdocs.map((tdoc) => tdoc.docId) },
                    source: 'redemption',
                    revokedAt: null,
                } as Filter<AccessEntitlementDoc>)
                .toArray(),
            this.entitlements
                .find({
                    domainId,
                    uid: user._id,
                    targetKind: 'course',
                    source: 'redemption',
                    revokedAt: null,
                } as Filter<AccessEntitlementDoc>)
                .toArray(),
            this.courses
                .find({
                    domainId,
                    docType: document.TYPE_TRAINING,
                    ...courseKindClause(),
                    'dag.problemSetId': { $in: tdocs.map((tdoc) => tdoc.docId) },
                } as Filter<TrainingDoc>)
                .toArray(),
        ]);
        const entitledCourseIds = new Set(courseEntitlements.map((row) => String(row.targetId)));
        const entitlementsBySet = new Map<string, AccessEntitlementDoc[]>();
        for (const entitlement of entitlements) {
            const key = String(entitlement.targetId);
            const list = entitlementsBySet.get(key) || [];
            list.push(entitlement);
            entitlementsBySet.set(key, list);
        }
        const coursesBySet = new Map<string, TrainingDoc[]>();
        const courseStageIdsBySet = new Map<string, { wholeSet: boolean; stageIds: Set<number> }>();
        for (const course of courses) {
            if (!courseVisibleTo(course, user, groupIds) && !entitledCourseIds.has(String(course.docId))) continue;
            for (const node of course.dag || []) {
                if (!node.problemSetId) continue;
                const key = String(node.problemSetId);
                const list = coursesBySet.get(key) || [];
                if (!list.some((item) => String(item.docId) === String(course.docId))) list.push(course);
                coursesBySet.set(key, list);
                const stageGrant = courseStageIdsBySet.get(key) || { wholeSet: false, stageIds: new Set<number>() };
                if (!Array.isArray(node.stageIds) || node.stageIds.length === 0) stageGrant.wholeSet = true;
                else for (const stageId of node.stageIds) stageGrant.stageIds.add(Number(stageId));
                courseStageIdsBySet.set(key, stageGrant);
            }
        }
        await Promise.all(
            tdocs.map(async (tdoc) => {
                if (!isProblemSetKind(tdoc.kind)) {
                    result.set(String(tdoc.docId), { discoverable: false, accessible: false, enrolled: false, sources: [], stageAccess: [] });
                    return;
                }
                const sources: ProblemSetAccessSource[] = [];
                if (canManageProblemSet(user, tdoc)) sources.push({ kind: 'manage' });
                const audience = problemSetAudienceOf(tdoc);
                if (audience.public) sources.push({ kind: 'public' });
                for (const groupId of audience.groupIds) {
                    if (groupIds.has(groupId)) sources.push({ kind: 'group', groupId });
                }
                for (const course of coursesBySet.get(String(tdoc.docId)) || []) {
                    sources.push({ kind: 'course', courseId: String(course.docId) });
                }
                const grantedStageIds = new Set<number>();
                let wholeSetRedemption = false;
                for (const entitlement of entitlementsBySet.get(String(tdoc.docId)) || []) {
                    if (entitlement.targetKind === 'problem_set' && entitlement.stageId === ACCESS_ENTITLEMENT_WHOLE_SET_STAGE) {
                        wholeSetRedemption = true;
                        sources.push({ kind: 'redemption', entitlementId: String(entitlement._id) });
                        continue;
                    }
                    if (entitlement.targetKind === 'problem_set_stage') {
                        grantedStageIds.add(entitlement.stageId);
                        sources.push({ kind: 'redemption', entitlementId: String(entitlement._id), stageId: entitlement.stageId });
                    }
                }
                const enrolled =
                    enrollments?.get(String(tdoc.docId)) ??
                    (user._id > 1 ? (await this.getEnrollment(domainId, tdoc.docId, user._id))?.enroll === 1 : false);
                const courseGrant = courseStageIdsBySet.get(String(tdoc.docId));
                if (courseGrant && !courseGrant.wholeSet) {
                    for (const stageId of courseGrant.stageIds) {
                        try {
                            for (const granted of computePrerequisiteClosure(tdoc.dag || [], stageId)) grantedStageIds.add(granted);
                        } catch (error) {
                            if (!(error instanceof ProblemSetStageGraphError)) throw error;
                            logger.warn(
                                'Course stage grant skipped invalid DAG closure domain=%s tid=%s stageId=%d reason=%s stage=evaluate result=fail-closed',
                                domainId,
                                tdoc.docId,
                                stageId,
                                error.reason,
                            );
                        }
                    }
                }
                const wholeSetAccess =
                    sources.some((source) => source.kind === 'public' || source.kind === 'group' || source.kind === 'manage') ||
                    wholeSetRedemption ||
                    !!courseGrant?.wholeSet;
                const granted = sources.length > 0;
                result.set(String(tdoc.docId), {
                    discoverable: granted,
                    accessible: granted,
                    enrolled: !!enrolled,
                    sources,
                    stageAccess: wholeSetAccess ? 'all' : Array.from(grantedStageIds).sort((left, right) => left - right),
                });
            }),
        );
        return result;
    }

    stageIsAccessible(decision: ProblemSetAccessDecision, stageId: number): boolean {
        if (!decision.accessible) return false;
        if (decision.stageAccess === 'all') return true;
        return decision.stageAccess.includes(stageId);
    }

    async assertStageEnterable(
        domainId: string,
        user: ProblemSetAccessUser,
        tdoc: TrainingDoc,
        stageId: number,
        doneNids: ReadonlySet<number>,
    ): Promise<ProblemSetAccessDecision> {
        const decision = await this.assertAccessible(domainId, user, tdoc);
        const node = trainingNodeById(tdoc.dag || [], stageId);
        if (!node) {
            logger.info(
                'Problem set stage missing domain=%s tid=%s uid=%d stageId=%d stage=assert-stage result=denied',
                domainId,
                tdoc.docId,
                user._id,
                stageId,
            );
            throw new NotFoundError(localizedErrorText`training`);
        }
        if (!this.stageIsAccessible(decision, stageId)) {
            logger.info(
                'Problem set stage access denied domain=%s tid=%s uid=%d stageId=%d stage=assert-stage result=no-access',
                domainId,
                tdoc.docId,
                user._id,
                stageId,
            );
            throw new ValidationError('stage', null, localizedErrorText`未获得该阶段的访问权`);
        }
        if (!prerequisitesCompleted(node, doneNids)) {
            logger.info(
                'Problem set stage prereq denied domain=%s tid=%s uid=%d stageId=%d stage=assert-stage result=prereq',
                domainId,
                tdoc.docId,
                user._id,
                stageId,
            );
            throw new ValidationError('stage', null, localizedErrorText`前置阶段尚未完成`);
        }
        return decision;
    }

    async grantStageRedemptionWithClosure(input: {
        domainId: string;
        uid: number;
        tdoc: TrainingDoc;
        stageId: number;
        sourceId: ObjectId;
    }): Promise<AccessEntitlementDoc[]> {
        const closure = computePrerequisiteClosure(input.tdoc.dag || [], input.stageId);
        const granted: AccessEntitlementDoc[] = [];
        for (const stageId of closure) {
            granted.push(
                await this.grantRedemptionEntitlement({
                    domainId: input.domainId,
                    uid: input.uid,
                    targetKind: 'problem_set_stage',
                    targetId: input.tdoc.docId,
                    stageId,
                    sourceId: input.sourceId,
                }),
            );
        }
        logger.info(
            'Stage redemption closure granted domain=%s uid=%d tid=%s stageId=%d stages=%o sourceId=%s stage=grant-closure result=success',
            input.domainId,
            input.uid,
            input.tdoc.docId,
            input.stageId,
            closure,
            input.sourceId,
        );
        return granted;
    }

    async assertAccessible(domainId: string, user: ProblemSetAccessUser, tdoc: TrainingDoc): Promise<ProblemSetAccessDecision> {
        const decision = await this.evaluate(domainId, user, tdoc);
        if (decision.accessible) return decision;
        logger.info(
            'Problem set access denied domain=%s tid=%s uid=%d enrolled=%s stage=assert-accessible result=denied',
            domainId,
            tdoc.docId,
            user._id,
            decision.enrolled,
        );
        throw new TrainingNotFoundError(domainId, tdoc.docId);
    }

    async grantRedemptionEntitlement(input: {
        domainId: string;
        uid: number;
        targetKind: AccessEntitlementTargetKind;
        targetId: ObjectId;
        stageId?: number;
        sourceId: ObjectId;
    }): Promise<AccessEntitlementDoc> {
        await this.ensureIndexes();
        const stageId = input.stageId ?? ACCESS_ENTITLEMENT_WHOLE_SET_STAGE;
        if (!Number.isSafeInteger(stageId) || stageId < 0) throw new TypeError('entitlement stageId must be a non-negative integer');
        assertObjectId(input.targetId, 'targetId');
        assertObjectId(input.sourceId, 'sourceId');
        const identity = {
            domainId: input.domainId,
            uid: input.uid,
            targetKind: input.targetKind,
            targetId: input.targetId,
            stageId,
            source: 'redemption' as const,
            sourceId: input.sourceId,
            revokedAt: null,
        };
        const existing = await this.entitlements.findOne(identity);
        if (existing) return existing;
        const doc: AccessEntitlementDoc = {
            _id: this.idFactory(),
            ...identity,
            createdAt: this.now(),
        };
        try {
            await this.entitlements.insertOne(doc);
        } catch (error) {
            const confirmed = await this.entitlements.findOne(identity);
            if (!confirmed) throw error;
            logger.warn(
                'Access entitlement confirmed after duplicate domain=%s uid=%d target=%s/%s sourceId=%s stage=grant result=idempotent',
                input.domainId,
                input.uid,
                input.targetKind,
                input.targetId,
                input.sourceId,
            );
            return confirmed;
        }
        logger.info(
            'Access entitlement granted domain=%s uid=%d target=%s/%s sourceId=%s entitlement=%s stage=grant result=success',
            input.domainId,
            input.uid,
            input.targetKind,
            input.targetId,
            input.sourceId,
            doc._id,
        );
        return doc;
    }

    async revokeRedemptionEntitlement(input: { domainId: string; uid: number; entitlementId: ObjectId }): Promise<AccessEntitlementDoc> {
        await this.ensureIndexes();
        const current = await this.entitlements.findOne({
            _id: input.entitlementId,
            domainId: input.domainId,
            uid: input.uid,
            source: 'redemption',
        });
        if (!current) throw new NotFoundError(localizedErrorText`entitlement`);
        if (current.revokedAt) return current;
        const revokedAt = this.now();
        const result = await this.entitlements.updateOne({ _id: current._id, revokedAt: null }, { $set: { revokedAt } });
        if (result.modifiedCount !== 1) {
            const confirmed = await this.entitlements.findOne({ _id: current._id });
            if (confirmed?.revokedAt) return confirmed;
            throw new Error(`access entitlement revoke CAS failed: ${input.domainId}/${input.entitlementId}`);
        }
        logger.info(
            'Access entitlement revoked domain=%s uid=%d entitlement=%s target=%s/%s stage=revoke result=success',
            input.domainId,
            input.uid,
            input.entitlementId,
            current.targetKind,
            current.targetId,
        );
        return { ...current, revokedAt };
    }

    async hasActiveEntitlement(
        domainId: string,
        uid: number,
        targetKind: AccessEntitlementTargetKind,
        targetId: ObjectId,
    ): Promise<boolean> {
        await this.ensureIndexes();
        const current = await this.entitlements.findOne({
            domainId,
            uid,
            targetKind,
            targetId,
            source: 'redemption',
            revokedAt: null,
        });
        return !!current;
    }

    async listActiveTargetIds(domainId: string, uid: number, targetKind: AccessEntitlementTargetKind): Promise<ObjectId[]> {
        await this.ensureIndexes();
        const rows = await this.entitlements
            .find({
                domainId,
                uid,
                targetKind,
                source: 'redemption',
                revokedAt: null,
            } as Filter<AccessEntitlementDoc>)
            .toArray();
        return rows.map((row) => row.targetId);
    }

    async listActiveBySource(domainId: string, uid: number, sourceId: ObjectId): Promise<AccessEntitlementDoc[]> {
        await this.ensureIndexes();
        return this.entitlements
            .find({
                domainId,
                uid,
                source: 'redemption',
                sourceId,
            } as Filter<AccessEntitlementDoc>)
            .toArray();
    }

    async getEntitlement(domainId: string, uid: number, entitlementId: ObjectId): Promise<AccessEntitlementDoc | null> {
        await this.ensureIndexes();
        return this.entitlements.findOne({
            _id: entitlementId,
            domainId,
            uid,
            source: 'redemption',
        });
    }

    async listActiveForTarget(
        domainId: string,
        uid: number,
        targetKind: AccessEntitlementTargetKind,
        targetId: ObjectId,
    ): Promise<AccessEntitlementDoc[]> {
        await this.ensureIndexes();
        return this.entitlements
            .find({
                domainId,
                uid,
                targetKind,
                targetId,
                source: 'redemption',
                revokedAt: null,
            } as Filter<AccessEntitlementDoc>)
            .toArray();
    }
}

export const accessEntitlementColl = db.collection<AccessEntitlementDoc>('access.entitlements');
export const problemSetAccessService = new ProblemSetAccessService({
    entitlements: accessEntitlementColl,
    courses: document.coll as unknown as CourseCollection,
});

export async function apply(ctx: Context): Promise<void> {
    await problemSetAccessService.ensureIndexes();
    ctx.on('domain/delete', async (domainId: string) => {
        await settleDomainCleanupOperations(domainId, [() => accessEntitlementColl.deleteMany({ domainId })]);
    });
}
