import { createHmac, randomBytes } from 'node:crypto';
import { Collection, Filter, ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { ForbiddenError, localizedErrorText, NotFoundError, ValidationError } from '../error';
import type { TrainingDoc } from '../interface';
import { Context } from '../context';
import db from '../service/db';
import { isCourseKind, isProblemSetKind } from '../lib/training-kind';
import { computePrerequisiteClosure } from '../lib/problem-set-stage';
import { PERM, PRIV } from './builtin';
import { ACCESS_ENTITLEMENT_WHOLE_SET_STAGE, problemSetAccessService, type AccessEntitlementTargetKind } from './problem-set-access';
import * as training from './training';
import { settleDomainCleanupOperations } from './domain-lifecycle-boundary';
import system from './system';

const logger = new Logger('redemption');
const HMAC_SETTING = 'redemption.hmacKeys';
function hasUnsafeRedemptionChars(value: string): boolean {
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (code <= 31 || code === 127) return true;
    }
    return false;
}

export type RedemptionTargetKind = AccessEntitlementTargetKind;
export type RedemptionCodeKind = 'single' | 'limited';
export type RedemptionCodeStatus = 'active' | 'disabled';

export interface RedemptionActor {
    _id: number;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (priv: number) => boolean;
    own: (doc: { owner?: number }) => boolean;
}

export interface RedemptionCodeBatchDoc {
    _id: ObjectId;
    domainId: string;
    createdBy: number;
    createdAt: Date;
    note: string;
    targetKind: RedemptionTargetKind;
    targetId: ObjectId;
    stageId: number;
    allowedGroupIds: string[];
    hmacKeyVersion: number;
    firstRedeemedAt: Date | null;
}

export interface RedemptionCodeDoc {
    _id: ObjectId;
    domainId: string;
    batchId: ObjectId;
    digest: string;
    hmacKeyVersion: number;
    hint: string;
    kind: RedemptionCodeKind;
    maxUses: number;
    usedCount: number;
    expiresAt: Date | null;
    status: RedemptionCodeStatus;
    manual: boolean;
    note: string;
    createdAt: Date;
}

export interface RedemptionDoc {
    _id: ObjectId;
    domainId: string;
    codeId: ObjectId;
    batchId: ObjectId;
    uid: number;
    createdAt: Date;
    entitlementIds: ObjectId[];
}

export interface PlainRedemptionCode {
    codeId: ObjectId;
    code: string;
    hint: string;
    weak: boolean;
}

type BatchCollection = Pick<Collection<RedemptionCodeBatchDoc>, 'createIndex' | 'find' | 'findOne' | 'insertOne' | 'updateOne' | 'deleteMany'>;
type CodeCollection = Pick<
    Collection<RedemptionCodeDoc>,
    'createIndex' | 'find' | 'findOne' | 'insertOne' | 'insertMany' | 'updateOne' | 'findOneAndUpdate' | 'deleteMany'
>;
type RedemptionCollection = Pick<Collection<RedemptionDoc>, 'createIndex' | 'find' | 'findOne' | 'insertOne' | 'deleteMany'>;

export interface RedemptionServiceOptions {
    batches: BatchCollection;
    codes: CodeCollection;
    redemptions: RedemptionCollection;
    now?: () => Date;
    idFactory?: () => ObjectId;
    randomCode?: () => string;
    loadTraining?: (domainId: string, tid: ObjectId) => Promise<TrainingDoc>;
    findStudentGroupIds?: (domainId: string, uid: number) => Promise<Set<string>>;
    hmacKeys?: () => Promise<{ current: number; keys: Record<string, string> }>;
}

export function normalizeRedemptionCode(value: unknown): string {
    if (typeof value !== 'string') throw new ValidationError('code', null, localizedErrorText`兑换码无效`);
    const normalized = value.trim();
    if (!normalized) throw new ValidationError('code', null, localizedErrorText`兑换码无效`);
    if (hasUnsafeRedemptionChars(normalized)) throw new ValidationError('code', null, localizedErrorText`兑换码包含不安全字符`);
    return normalized;
}

export function redemptionCodeIsWeak(code: string): boolean {
    return code.length < 8 || /^[0-9]+$/.test(code) || /^[a-zA-Z]+$/.test(code);
}

function digestOf(keyHex: string, domainId: string, code: string): string {
    return createHmac('sha256', Buffer.from(keyHex, 'hex')).update(`${domainId}\0${code}`, 'utf8').digest('hex');
}

function hintOf(digest: string): string {
    return digest.slice(-8);
}

const codeGates = new Map<string, Promise<unknown>>();
async function withCodeGate<T>(codeId: string, work: () => Promise<T>): Promise<T> {
    const previous = codeGates.get(codeId) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
        release = resolve;
    });
    const chained = previous.then(
        () => current,
        () => current,
    );
    codeGates.set(codeId, chained);
    await previous.catch(() => undefined);
    try {
        return await work();
    } finally {
        release();
        if (codeGates.get(codeId) === chained) codeGates.delete(codeId);
    }
}

async function defaultHmacKeys(): Promise<{ current: number; keys: Record<string, string> }> {
    const stored = system.get(HMAC_SETTING);
    if (stored && typeof stored === 'object' && !Array.isArray(stored) && Number.isSafeInteger((stored as { current?: unknown }).current)) {
        return stored as { current: number; keys: Record<string, string> };
    }
    const generated = { current: 1, keys: { 1: randomBytes(32).toString('hex') } };
    await system.set(HMAC_SETTING, generated);
    logger.info('Redemption HMAC key created version=1 stage=hmac result=generated');
    return generated;
}

async function defaultFindStudentGroupIds(domainId: string, uid: number): Promise<Set<string>> {
    if (!uid || uid <= 1) return new Set();
    const findStudent = global.Hydro?.model?.userbind?.findStudentByUserId;
    if (typeof findStudent !== 'function') throw new TypeError('userbind.findStudentByUserId is unavailable');
    const student = await findStudent(domainId, uid);
    return new Set((student?.groupIds || []).map((groupId: ObjectId) => String(groupId)));
}

export function canCreateRedemption(user: RedemptionActor): boolean {
    return user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || user.hasPerm(PERM.PERM_CREATE_REDEMPTION_CODE);
}

export function canManageAllRedemptions(user: RedemptionActor): boolean {
    return user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}

function canManageTarget(user: RedemptionActor, tdoc: TrainingDoc, targetKind: RedemptionTargetKind): boolean {
    if (user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return true;
    if (targetKind === 'course') return user.hasPerm(PERM.PERM_EDIT_COURSE) || user.own(tdoc);
    return user.hasPerm(PERM.PERM_EDIT_TRAINING) || (user.own(tdoc) && user.hasPerm(PERM.PERM_EDIT_TRAINING_SELF));
}

export class RedemptionService {
    private readonly batches: BatchCollection;
    private readonly codes: CodeCollection;
    private readonly redemptions: RedemptionCollection;
    private readonly now: () => Date;
    private readonly idFactory: () => ObjectId;
    private readonly randomCode: () => string;
    private readonly loadTraining: (domainId: string, tid: ObjectId) => Promise<TrainingDoc>;
    private readonly findStudentGroupIds: (domainId: string, uid: number) => Promise<Set<string>>;
    private readonly hmacKeys: () => Promise<{ current: number; keys: Record<string, string> }>;
    private indexesPromise?: Promise<void>;

    constructor(options: RedemptionServiceOptions) {
        this.batches = options.batches;
        this.codes = options.codes;
        this.redemptions = options.redemptions;
        this.now = options.now || (() => new Date());
        this.idFactory = options.idFactory || (() => new ObjectId());
        this.randomCode = options.randomCode || (() => randomBytes(16).toString('base64url'));
        this.loadTraining = options.loadTraining || ((domainId, tid) => training.get(domainId, tid));
        this.findStudentGroupIds = options.findStudentGroupIds || defaultFindStudentGroupIds;
        this.hmacKeys = options.hmacKeys || defaultHmacKeys;
    }

    async ensureIndexes(): Promise<void> {
        if (!this.indexesPromise) {
            this.indexesPromise = Promise.all([
                this.batches.createIndex({ domainId: 1, createdAt: -1 }, { name: 'redemptionBatchLookup' }),
                this.codes.createIndex({ domainId: 1, digest: 1 }, { name: 'redemptionCodeDigest', unique: true }),
                this.codes.createIndex({ domainId: 1, batchId: 1, createdAt: -1 }, { name: 'redemptionCodeBatch' }),
                this.redemptions.createIndex({ domainId: 1, codeId: 1, uid: 1 }, { name: 'redemptionIdentity', unique: true }),
                this.redemptions.createIndex({ domainId: 1, uid: 1, createdAt: -1 }, { name: 'redemptionUserLookup' }),
            ])
                .then(() => undefined)
                .catch((error) => {
                    this.indexesPromise = undefined;
                    logger.error('Redemption index verification failed error=%o', error);
                    throw error;
                });
        }
        await this.indexesPromise;
    }

    async assertManagePermission(user: RedemptionActor, batch?: Pick<RedemptionCodeBatchDoc, 'createdBy'>): Promise<void> {
        if (!canCreateRedemption(user)) throw new ForbiddenError(localizedErrorText`没有兑换码管理权限`);
        if (batch && !canManageAllRedemptions(user) && batch.createdBy !== user._id) {
            throw new ForbiddenError(localizedErrorText`没有兑换码管理权限`);
        }
    }

    async resolveTarget(domainId: string, targetKind: RedemptionTargetKind, targetId: ObjectId, stageId = ACCESS_ENTITLEMENT_WHOLE_SET_STAGE) {
        const tdoc = await this.loadTraining(domainId, targetId);
        if (targetKind === 'course') {
            if (!isCourseKind(tdoc.kind)) throw new ValidationError('target', null, localizedErrorText`兑换目标不是课程`);
        } else if (!isProblemSetKind(tdoc.kind)) {
            throw new ValidationError('target', null, localizedErrorText`兑换目标不是题集`);
        }
        if (targetKind === 'problem_set_stage') {
            computePrerequisiteClosure(tdoc.dag || [], stageId);
        } else if (stageId !== ACCESS_ENTITLEMENT_WHOLE_SET_STAGE) {
            throw new ValidationError('stageId', null, localizedErrorText`整集或课程目标不能指定阶段`);
        }
        return tdoc;
    }

    async createBatch(input: {
        domainId: string;
        user: RedemptionActor;
        note?: string;
        targetKind: RedemptionTargetKind;
        targetId: ObjectId;
        stageId?: number;
        allowedGroupIds?: string[];
        kind: RedemptionCodeKind;
        maxUses?: number;
        expiresAt?: Date | null;
        count?: number;
        manualCodes?: string[];
    }): Promise<{ batch: RedemptionCodeBatchDoc; plaintext: PlainRedemptionCode[]; warning?: string }> {
        await this.ensureIndexes();
        await this.assertManagePermission(input.user);
        const stageId = input.stageId ?? ACCESS_ENTITLEMENT_WHOLE_SET_STAGE;
        const tdoc = await this.resolveTarget(input.domainId, input.targetKind, input.targetId, stageId);
        if (!canManageTarget(input.user, tdoc, input.targetKind)) throw new ForbiddenError(localizedErrorText`没有兑换目标的管理权限`);
        const maxUses = input.kind === 'single' ? 1 : input.maxUses;
        if (!Number.isSafeInteger(maxUses) || (maxUses as number) < 1) throw new ValidationError('maxUses', null, localizedErrorText`兑换次数上限无效`);
        const manualCodes = (input.manualCodes || []).map((code) => normalizeRedemptionCode(code));
        const count = manualCodes.length || input.count || 1;
        if (!Number.isSafeInteger(count) || count < 1 || count > 500) throw new ValidationError('count', null, localizedErrorText`兑换码数量无效`);
        if (manualCodes.length && manualCodes.length !== count) throw new ValidationError('code', null, localizedErrorText`手工码数量与生成数量不一致`);
        if (input.kind === 'limited' && count !== 1 && !manualCodes.length) {
            throw new ValidationError('count', null, localizedErrorText`通用码一次只能创建一条`);
        }
        const keys = await this.hmacKeys();
        const batch: RedemptionCodeBatchDoc = {
            _id: this.idFactory(),
            domainId: input.domainId,
            createdBy: input.user._id,
            createdAt: this.now(),
            note: String(input.note || ''),
            targetKind: input.targetKind,
            targetId: input.targetId,
            stageId,
            allowedGroupIds: Array.from(new Set(input.allowedGroupIds || [])),
            hmacKeyVersion: keys.current,
            firstRedeemedAt: null,
        };
        const plaintext: PlainRedemptionCode[] = [];
        const docs: RedemptionCodeDoc[] = [];
        const seen = new Set<string>();
        for (let index = 0; index < count; index++) {
            const code = manualCodes[index] || this.randomCode();
            const normalized = normalizeRedemptionCode(code);
            const digest = digestOf(keys.keys[String(keys.current)], input.domainId, normalized);
            if (seen.has(digest)) throw new ValidationError('code', null, localizedErrorText`兑换码摘要冲突`);
            seen.add(digest);
            const existing = await this.codes.findOne({ domainId: input.domainId, digest });
            if (existing) throw new ValidationError('code', null, localizedErrorText`兑换码摘要冲突`);
            const doc: RedemptionCodeDoc = {
                _id: this.idFactory(),
                domainId: input.domainId,
                batchId: batch._id,
                digest,
                hmacKeyVersion: keys.current,
                hint: hintOf(digest),
                kind: input.kind,
                maxUses: maxUses as number,
                usedCount: 0,
                expiresAt: input.expiresAt || null,
                status: 'active',
                manual: !!manualCodes[index],
                note: String(input.note || ''),
                createdAt: this.now(),
            };
            docs.push(doc);
            plaintext.push({ codeId: doc._id, code: normalized, hint: doc.hint, weak: redemptionCodeIsWeak(normalized) });
        }
        await this.batches.insertOne(batch);
        try {
            await this.codes.insertMany(docs as any);
        } catch (error) {
            await this.codes.deleteMany({ batchId: batch._id });
            await this.batches.updateOne({ _id: batch._id }, { $set: { note: 'create_failed' } });
            logger.error('Redemption code insert failed batch=%s error=%o', batch._id, error);
            throw new ValidationError('code', null, localizedErrorText`兑换码摘要冲突`);
        }
        logger.info(
            'Redemption batch created domain=%s batch=%s uid=%d target=%s/%s count=%d stage=create result=success',
            input.domainId,
            batch._id,
            input.user._id,
            input.targetKind,
            input.targetId,
            docs.length,
        );
        const warning = plaintext.some((item) => item.weak) ? '手工码强度较弱，创建后不可改码值。' : undefined;
        return { batch, plaintext, warning };
    }

    async listBatches(domainId: string, user: RedemptionActor) {
        await this.ensureIndexes();
        await this.assertManagePermission(user);
        const filter: Filter<RedemptionCodeBatchDoc> = canManageAllRedemptions(user) ? { domainId } : { domainId, createdBy: user._id };
        return this.batches.find(filter).toArray();
    }

    async getBatch(domainId: string, user: RedemptionActor, batchId: ObjectId) {
        await this.ensureIndexes();
        const batch = await this.batches.findOne({ _id: batchId, domainId });
        if (!batch) throw new NotFoundError(localizedErrorText`兑换批次`);
        await this.assertManagePermission(user, batch);
        const codes = await this.codes.find({ domainId, batchId }).toArray();
        return { batch, codes };
    }

    async editBatch(input: {
        domainId: string;
        user: RedemptionActor;
        batchId: ObjectId;
        note?: string;
        targetKind?: RedemptionTargetKind;
        targetId?: ObjectId;
        stageId?: number;
        allowedGroupIds?: string[];
        expiresAt?: Date | null;
        maxUses?: number;
    }) {
        await this.ensureIndexes();
        const { batch, codes } = await this.getBatch(input.domainId, input.user, input.batchId);
        const frozen = !!batch.firstRedeemedAt;
        const $set: Partial<RedemptionCodeBatchDoc> = {};
        if (input.note !== undefined) $set.note = String(input.note);
        if (!frozen) {
            if (input.targetKind || input.targetId || input.stageId !== undefined) {
                const targetKind = input.targetKind || batch.targetKind;
                const targetId = input.targetId || batch.targetId;
                const stageId = input.stageId ?? batch.stageId;
                const tdoc = await this.resolveTarget(input.domainId, targetKind, targetId, stageId);
                if (!canManageTarget(input.user, tdoc, targetKind)) throw new ForbiddenError(localizedErrorText`没有兑换目标的管理权限`);
                $set.targetKind = targetKind;
                $set.targetId = targetId;
                $set.stageId = stageId;
            }
            if (input.allowedGroupIds) $set.allowedGroupIds = Array.from(new Set(input.allowedGroupIds));
        } else if (input.targetKind || input.targetId || input.stageId !== undefined || input.allowedGroupIds) {
            throw new ValidationError('batch', null, localizedErrorText`首次兑换后不能修改目标和允许用户组`);
        }
        if (Object.keys($set).length) await this.batches.updateOne({ _id: batch._id }, { $set });
        const codeSet: Partial<RedemptionCodeDoc> = {};
        if (input.note !== undefined) codeSet.note = String(input.note);
        if (input.expiresAt !== undefined) codeSet.expiresAt = input.expiresAt;
        if (input.maxUses !== undefined) {
            if (!Number.isSafeInteger(input.maxUses) || input.maxUses < 1) throw new ValidationError('maxUses', null, localizedErrorText`兑换次数上限无效`);
            for (const code of codes) {
                if (input.maxUses < code.usedCount) throw new ValidationError('maxUses', null, localizedErrorText`兑换次数上限不能低于已用次数`);
                if (frozen && input.maxUses < code.maxUses) throw new ValidationError('maxUses', null, localizedErrorText`首次兑换后只能提高上限`);
            }
            codeSet.maxUses = input.maxUses;
        }
        if (Object.keys(codeSet).length) {
            for (const code of codes) {
                await this.codes.updateOne({ _id: code._id }, { $set: codeSet });
            }
        }
        logger.info('Redemption batch edited domain=%s batch=%s frozen=%s stage=edit result=success', input.domainId, batch._id, frozen);
        return this.getBatch(input.domainId, input.user, input.batchId);
    }

    async disableCode(domainId: string, user: RedemptionActor, codeId: ObjectId) {
        await this.ensureIndexes();
        const code = await this.codes.findOne({ _id: codeId, domainId });
        if (!code) throw new NotFoundError(localizedErrorText`兑换码`);
        const batch = await this.batches.findOne({ _id: code.batchId, domainId });
        if (!batch) throw new NotFoundError(localizedErrorText`兑换批次`);
        await this.assertManagePermission(user, batch);
        if (code.status === 'disabled') return code;
        const result = await this.codes.updateOne({ _id: code._id, status: 'active' }, { $set: { status: 'disabled' } });
        if (result.modifiedCount !== 1) {
            const confirmed = await this.codes.findOne({ _id: code._id });
            if (confirmed?.status === 'disabled') return confirmed;
            throw new Error(`redemption code disable CAS failed: ${domainId}/${codeId}`);
        }
        logger.info('Redemption code disabled domain=%s code=%s batch=%s stage=disable result=success', domainId, code._id, code.batchId);
        return { ...code, status: 'disabled' as const };
    }

    async redeem(input: { domainId: string; uid: number; code: string; user: RedemptionActor }): Promise<RedemptionDoc> {
        await this.ensureIndexes();
        const normalized = normalizeRedemptionCode(input.code);
        const keys = await this.hmacKeys();
        let code: RedemptionCodeDoc | null = null;
        for (const [version, keyHex] of Object.entries(keys.keys)) {
            const digest = digestOf(keyHex, input.domainId, normalized);
            const found = await this.codes.findOne({ domainId: input.domainId, digest, hmacKeyVersion: Number(version) });
            if (found) {
                code = found;
                break;
            }
        }
        if (!code) {
            logger.info('Redemption code miss domain=%s uid=%d stage=redeem result=not-found', input.domainId, input.uid);
            throw new NotFoundError(localizedErrorText`兑换码`);
        }
        return withCodeGate(String(code._id), async () => {
            const current = await this.codes.findOne({ _id: code!._id });
            if (!current) throw new NotFoundError(localizedErrorText`兑换码`);
            const existing = await this.redemptions.findOne({ domainId: input.domainId, codeId: current._id, uid: input.uid });
            if (existing) return existing;
            if (current.status !== 'active') throw new ValidationError('code', null, localizedErrorText`兑换码已停用`);
            if (current.expiresAt && current.expiresAt.getTime() <= this.now().getTime()) throw new ValidationError('code', null, localizedErrorText`兑换码已过期`);
            const batch = await this.batches.findOne({ _id: current.batchId, domainId: input.domainId });
            if (!batch) throw new NotFoundError(localizedErrorText`兑换批次`);
            if (batch.allowedGroupIds.length) {
                const groups = await this.findStudentGroupIds(input.domainId, input.uid);
                if (!batch.allowedGroupIds.some((groupId) => groups.has(groupId))) {
                    throw new ForbiddenError(localizedErrorText`当前用户组不能兑换该码`);
                }
            }
            const tdoc = await this.resolveTarget(input.domainId, batch.targetKind, batch.targetId, batch.stageId);
            const updated = await this.codes.findOneAndUpdate(
                { _id: current._id, status: 'active', usedCount: { $lt: current.maxUses } },
                { $inc: { usedCount: 1 } },
                { returnDocument: 'after' },
            );
            if (!updated) throw new ValidationError('code', null, localizedErrorText`兑换名额已满`);
            const entitlementIds: ObjectId[] = [];
            if (batch.targetKind === 'problem_set_stage') {
                const granted = await problemSetAccessService.grantStageRedemptionWithClosure({
                    domainId: input.domainId,
                    uid: input.uid,
                    tdoc,
                    stageId: batch.stageId,
                    sourceId: current._id,
                });
                entitlementIds.push(...granted.map((row) => row._id));
            } else {
                const granted = await problemSetAccessService.grantRedemptionEntitlement({
                    domainId: input.domainId,
                    uid: input.uid,
                    targetKind: batch.targetKind,
                    targetId: batch.targetId,
                    sourceId: current._id,
                });
                entitlementIds.push(granted._id);
            }
            await training.ensureEnrolled(input.domainId, tdoc.docId, input.uid);
            const redemption: RedemptionDoc = {
                _id: this.idFactory(),
                domainId: input.domainId,
                codeId: current._id,
                batchId: batch._id,
                uid: input.uid,
                createdAt: this.now(),
                entitlementIds,
            };
            try {
                await this.redemptions.insertOne(redemption);
            } catch (error) {
                const confirmed = await this.redemptions.findOne({ domainId: input.domainId, codeId: current._id, uid: input.uid });
                if (!confirmed) throw error;
                return confirmed;
            }
            if (!batch.firstRedeemedAt) {
                await this.batches.updateOne({ _id: batch._id, firstRedeemedAt: null }, { $set: { firstRedeemedAt: this.now() } });
            }
            logger.info(
                'Redemption succeeded domain=%s uid=%d code=%s batch=%s target=%s/%s stage=redeem result=success',
                input.domainId,
                input.uid,
                current._id,
                batch._id,
                batch.targetKind,
                batch.targetId,
            );
            return redemption;
        });
    }

    async revokeUserSource(input: { domainId: string; user: RedemptionActor; uid: number; entitlementId: ObjectId }) {
        await this.ensureIndexes();
        await this.assertManagePermission(input.user);
        const revoked = await problemSetAccessService.revokeRedemptionEntitlement({
            domainId: input.domainId,
            uid: input.uid,
            entitlementId: input.entitlementId,
        });
        logger.info(
            'Redemption entitlement revoked domain=%s actor=%d uid=%d entitlement=%s stage=revoke result=success',
            input.domainId,
            input.user._id,
            input.uid,
            input.entitlementId,
        );
        return revoked;
    }
}

export const redemptionBatchColl = db.collection<RedemptionCodeBatchDoc>('redemption.batches');
export const redemptionCodeColl = db.collection<RedemptionCodeDoc>('redemption.codes');
export const redemptionColl = db.collection<RedemptionDoc>('redemption.redemptions');
export const redemptionService = new RedemptionService({
    batches: redemptionBatchColl,
    codes: redemptionCodeColl,
    redemptions: redemptionColl,
});

export async function apply(ctx: Context): Promise<void> {
    await redemptionService.ensureIndexes();
    ctx.on('domain/delete', async (domainId: string) => {
        await settleDomainCleanupOperations(domainId, [
            () => redemptionColl.deleteMany({ domainId }),
            () => redemptionCodeColl.deleteMany({ domainId }),
            () => redemptionBatchColl.deleteMany({ domainId }),
        ]);
    });
}

global.Hydro.model.redemption = {
    redemptionService,
    normalizeRedemptionCode,
    canCreateRedemption,
    canManageAllRedemptions,
};
