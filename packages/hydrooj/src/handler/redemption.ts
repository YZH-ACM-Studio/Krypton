import { ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { localizedErrorText, ValidationError } from '../error';
import { PERM, PRIV } from '../model/builtin';
import { ACCESS_ENTITLEMENT_WHOLE_SET_STAGE } from '../model/problem-set-access';
import { canCreateRedemption, canManageAllRedemptions, redemptionService, type RedemptionTargetKind } from '../model/redemption';
import * as training from '../model/training';
import { Handler, param, Types } from '../service/server';
import { isCourseKind } from '../lib/training-kind';

const logger = new Logger('redemption-handler');

function csvCell(value: unknown): string {
    let text = String(value ?? '');
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

function parseTargetKind(value: string): RedemptionTargetKind {
    if (value === 'problem_set' || value === 'problem_set_stage' || value === 'course') return value;
    throw new ValidationError('targetKind', null, localizedErrorText`兑换目标不是题集`);
}

function parseOptionalDate(value?: string): Date | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new ValidationError('expiresAt', null, localizedErrorText`有效期无效`);
    return date;
}

class RedemptionManageHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        if (!canCreateRedemption(this.user)) this.checkPerm(PERM.PERM_CREATE_REDEMPTION_CODE);
    }

    private async renderManage(extra: Record<string, unknown> = {}) {
        const domainId = String(this.domain?._id);
        const batches = await redemptionService.listBatches(domainId, this.user);
        this.response.template = 'redemption_code_manage.html';
        this.response.body = {
            batches,
            canManageAll: canManageAllRedemptions(this.user),
            ...extra,
        };
        this.response.addHeader('Cache-Control', 'no-store');
    }

    async get() {
        await this.renderManage();
    }

    @param('note', Types.String, true)
    @param('targetKind', Types.String)
    @param('targetId', Types.ObjectId)
    @param('stageId', Types.UnsignedInt, true)
    @param('allowedGroupIds', Types.CommaSeperatedArray, true)
    @param('kind', Types.String)
    @param('maxUses', Types.PositiveInt, true)
    @param('expiresAt', Types.String, true)
    @param('count', Types.PositiveInt, true)
    @param('manualCodes', Types.Content, true)
    async postCreate(
        _domainId: string,
        note: string,
        targetKindRaw: string,
        targetId: ObjectId,
        stageId = ACCESS_ENTITLEMENT_WHOLE_SET_STAGE,
        allowedGroupIds: string[] = [],
        kindRaw = 'single',
        maxUses = 1,
        expiresAt = '',
        count = 1,
        manualCodesRaw = '',
    ) {
        const domainId = String(this.domain?._id);
        const kind = kindRaw === 'limited' ? 'limited' : 'single';
        const manualCodes = String(manualCodesRaw || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        const created = await redemptionService.createBatch({
            domainId,
            user: this.user,
            note,
            targetKind: parseTargetKind(targetKindRaw),
            targetId,
            stageId,
            allowedGroupIds,
            kind,
            maxUses,
            expiresAt: parseOptionalDate(expiresAt),
            count: manualCodes.length || count,
            manualCodes,
        });
        await this.renderManage({
            once: true,
            warning: created.warning || null,
            batch: created.batch,
            plaintext: created.plaintext,
            csv: [
                ['batchId', 'targetKind', 'targetId', 'stageId', 'code'].map(csvCell).join(','),
                ...created.plaintext.map((item) =>
                    [created.batch._id, created.batch.targetKind, created.batch.targetId, created.batch.stageId, item.code].map(csvCell).join(','),
                ),
            ].join('\r\n'),
        });
    }

    @param('batchId', Types.ObjectId)
    @param('note', Types.String, true)
    @param('targetKind', Types.String, true)
    @param('targetId', Types.ObjectId, true)
    @param('stageId', Types.UnsignedInt, true)
    @param('allowedGroupIds', Types.CommaSeperatedArray, true)
    @param('expiresAt', Types.String, true)
    @param('maxUses', Types.PositiveInt, true)
    async postEdit(
        _domainId: string,
        batchId: ObjectId,
        note?: string,
        targetKind?: string,
        targetId?: ObjectId,
        stageId?: number,
        allowedGroupIds?: string[],
        expiresAt?: string,
        maxUses?: number,
    ) {
        const domainId = String(this.domain?._id);
        await redemptionService.editBatch({
            domainId,
            user: this.user,
            batchId,
            note,
            targetKind: targetKind ? parseTargetKind(targetKind) : undefined,
            targetId,
            stageId,
            allowedGroupIds,
            expiresAt: expiresAt === undefined ? undefined : parseOptionalDate(expiresAt),
            maxUses,
        });
        await this.renderManage();
    }

    @param('codeId', Types.ObjectId)
    async postDisable(_domainId: string, codeId: ObjectId) {
        await redemptionService.disableCode(String(this.domain?._id), this.user, codeId);
        await this.renderManage();
    }

    @param('uid', Types.PositiveInt)
    @param('entitlementId', Types.ObjectId)
    async postRevoke(_domainId: string, uid: number, entitlementId: ObjectId) {
        const result = await redemptionService.revokeUserSource({
            domainId: String(this.domain?._id),
            user: this.user,
            uid,
            entitlementId,
        });
        await this.renderManage({
            revokeResult: {
                revokedCount: result.revoked.length,
                remainingSources: result.remainingSources,
            },
        });
    }

    @param('batchId', Types.ObjectId)
    async postDetail(_domainId: string, batchId: ObjectId) {
        this.response.body = await redemptionService.getBatch(String(this.domain?._id), this.user, batchId);
        this.response.addHeader('Cache-Control', 'no-store');
    }
}

class RedeemHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    async get() {
        this.response.template = 'redeem.html';
        this.response.body = { result: null };
        this.response.addHeader('Cache-Control', 'no-store');
    }

    @param('code', Types.String)
    async post(_domainId: string, code: string) {
        await this.limitRate('redeem_code', 60, 8);
        const domainId = String(this.domain?._id);
        const redemption = await redemptionService.redeem({
            domainId,
            uid: this.user._id,
            user: this.user,
            code,
        });
        const result: {
            ok: true;
            redemptionId: string;
            batchId: string;
            targetKind: string | null;
            title: string | null;
            href: string | null;
        } = {
            ok: true,
            redemptionId: String(redemption._id),
            batchId: String(redemption.batchId),
            targetKind: redemption.targetKind || null,
            title: null,
            href: null,
        };
        if (redemption.targetKind && redemption.targetId) {
            try {
                const tdoc = await training.get(domainId, redemption.targetId);
                result.title = String(tdoc.title || '');
                result.href = isCourseKind(tdoc.kind) ? `/course/${tdoc.docId}` : `/problem-sets/${tdoc.docId}`;
            } catch (error) {
                logger.warn(
                    'Redeem succeeded but target title lookup failed domain=%s uid=%d redemption=%s stage=redeem result=target-lookup-failed error=%s',
                    domainId,
                    this.user._id,
                    redemption._id,
                    error instanceof Error ? error.message : String(error),
                );
            }
        }
        if (!this.request.json) this.response.template = 'redeem.html';
        this.response.body = { result };
        this.response.addHeader('Cache-Control', 'no-store');
    }
}

export async function apply(ctx: any) {
    ctx.Route('manage_redemption_codes', '/manage/redemption-codes', RedemptionManageHandler);
    ctx.Route('redeem', '/redeem', RedeemHandler);
}
