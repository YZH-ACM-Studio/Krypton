import { Logger } from '@hydrooj/utils';
import { ObjectId } from 'mongodb';
import { Context, Handler, OplogModel, param, PRIV, requireServiceToken, Types, ValidationError } from 'hydrooj';
import { EndpointEnrollmentBatchDoc, EndpointEnrollmentError, endpointEnrollmentBatchService } from '../model/endpoint-enrollment';
import { revokeEndpointOnVigilStrict } from '../service/vigil-bridge';

const logger = new Logger('endpoint-enrollment');

function serializeBatch(batch: EndpointEnrollmentBatchDoc) {
    return {
        batchId: batch._id.toHexString(),
        domainId: batch.domainId,
        codeHint: batch.codeHint,
        status: batch.status,
        expiresAt: batch.expiresAt.toISOString(),
        maxEnrollments: batch.maxEnrollments,
        usedCount: batch.usedCount,
        replacesEndpointId: batch.replacesEndpointId || null,
        createdBy: batch.createdBy,
        createdAt: batch.createdAt.toISOString(),
        updatedBy: batch.updatedBy,
        updatedAt: batch.updatedAt.toISOString(),
        revision: batch.revision,
        claims: batch.claims.map((claim) => ({
            claimId: claim.claimId,
            hostname: claim.hostname,
            reservedAt: claim.reservedAt.toISOString(),
            endpointId: claim.endpointId || null,
            finalizedAt: claim.finalizedAt?.toISOString() || null,
        })),
    };
}

function parseExpiry(value: string): Date {
    const expiry = new Date(value);
    if (!value || !Number.isFinite(expiry.getTime())) throw new ValidationError('expiresAt');
    return expiry;
}

function enrollmentErrorStatus(reason: string): number {
    if (reason === 'invalid_code' || reason.startsWith('invalid_')) return 400;
    if (reason === 'expired' || reason === 'revoked') return 410;
    if (reason === 'exhausted') return 409;
    if (reason === 'batch_not_found' || reason === 'claim_not_found') return 404;
    return 409;
}

class EndpointEnrollmentAdminHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await endpointEnrollmentBatchService.ensureIndexes();
    }

    async get() {
        const batches = await endpointEnrollmentBatchService.list(this.domain._id, 200);
        this.response.body = { batches: batches.map(serializeBatch) };
    }

    @param('expiresAt', Types.String)
    @param('maxEnrollments', Types.UnsignedInt)
    @param('replacesEndpointId', Types.String, true)
    async post(_args: unknown, expiresAt: string, maxEnrollments: number, replacesEndpointId = '') {
        try {
            const { batch, enrollmentCode } = await endpointEnrollmentBatchService.createBatch({
                domainId: this.domain._id,
                actorUid: this.user._id,
                expiresAt: parseExpiry(expiresAt),
                maxEnrollments,
                ...(replacesEndpointId ? { replacesEndpointId } : {}),
            });
            await OplogModel.log(this, 'endpoint.enrollment_batch.create', {
                batchId: batch._id,
                expiresAt: batch.expiresAt,
                maxEnrollments: batch.maxEnrollments,
                replacesEndpointId: batch.replacesEndpointId || null,
                revision: batch.revision,
            });
            this.response.body = {
                batch: serializeBatch(batch),
                enrollmentCode,
                warning: 'This enrollment code is shown only in this response.',
            };
        } catch (error) {
            if (!(error instanceof EndpointEnrollmentError)) throw error;
            throw new ValidationError('endpointEnrollment', null, error.reason);
        }
    }
}

class EndpointEnrollmentBatchRevokeHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await endpointEnrollmentBatchService.ensureIndexes();
    }

    @param('batchId', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    async post(_args: unknown, batchId: ObjectId, expectedRevision: number) {
        try {
            const batch = await endpointEnrollmentBatchService.revokeBatch({
                batchId,
                actorUid: this.user._id,
                expectedRevision,
            });
            await OplogModel.log(this, 'endpoint.enrollment_batch.revoke', {
                batchId,
                revision: batch.revision,
            });
            this.response.body = { batch: serializeBatch(batch) };
        } catch (error) {
            if (!(error instanceof EndpointEnrollmentError)) throw error;
            throw new ValidationError('endpointEnrollment', null, error.reason);
        }
    }
}

class EndpointCredentialRevokeHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
        await endpointEnrollmentBatchService.ensureIndexes();
    }

    @param('endpointId', Types.String)
    @param('reason', Types.String)
    async post(_args: unknown, endpointId: string, reason: string) {
        const canonicalEndpointId = endpointId.trim();
        const canonicalReason = reason.trim();
        if (!/^ep_[A-Za-z0-9_-]{12,80}$/.test(canonicalEndpointId)) throw new ValidationError('endpointId');
        if (!canonicalReason || canonicalReason.length > 500) throw new ValidationError('reason');
        await revokeEndpointOnVigilStrict(canonicalEndpointId, this.user._id, canonicalReason);
        await OplogModel.log(this, 'endpoint.credential.revoke', {
            endpointId: canonicalEndpointId,
            reason: canonicalReason,
        });
        this.response.body = { ok: true, endpointId: canonicalEndpointId };
    }
}

abstract class VigilEndpointEnrollmentHandler extends Handler {
    noCheckPermView = true;

    async prepare() {
        requireServiceToken(this, 'vigil');
        await endpointEnrollmentBatchService.ensureIndexes();
    }

    protected reject(error: EndpointEnrollmentError, stage: string, claimId: string) {
        logger.warn('Endpoint enrollment rejected stage=%s claim=%s reason=%s', stage, claimId, error.reason);
        this.response.status = enrollmentErrorStatus(error.reason);
        this.response.body = { error: error.reason };
    }
}

class VigilEndpointEnrollmentConsumeHandler extends VigilEndpointEnrollmentHandler {
    @param('enrollmentCode', Types.String)
    @param('claimId', Types.String)
    @param('publicKeyFingerprint', Types.String)
    @param('machineFingerprint', Types.String)
    @param('hostname', Types.String)
    async post(_args: unknown, enrollmentCode: string, claimId: string, publicKeyFingerprint: string, machineFingerprint: string, hostname: string) {
        try {
            const claim = await endpointEnrollmentBatchService.consume({
                enrollmentCode,
                claimId,
                publicKeyFingerprint,
                machineFingerprint,
                hostname,
            });
            logger.info(
                'Endpoint enrollment reserved stage=consume batch=%s claim=%s endpoint=%s replacement=%s',
                claim.batchId,
                claim.claimId,
                claim.endpointId || '',
                claim.replacesEndpointId || '',
            );
            this.response.body = {
                batchId: claim.batchId.toHexString(),
                claimId: claim.claimId,
                domainId: claim.domainId,
                endpointId: claim.endpointId || null,
                replacesEndpointId: claim.replacesEndpointId || null,
            };
        } catch (error) {
            if (!(error instanceof EndpointEnrollmentError)) throw error;
            this.reject(error, 'consume', claimId);
        }
    }
}

class VigilEndpointEnrollmentFinalizeHandler extends VigilEndpointEnrollmentHandler {
    @param('batchId', Types.ObjectId)
    @param('claimId', Types.String)
    @param('endpointId', Types.String)
    async post(_args: unknown, batchId: ObjectId, claimId: string, endpointId: string) {
        try {
            const batch = await endpointEnrollmentBatchService.finalize({ batchId, claimId, endpointId });
            logger.info(
                'Endpoint enrollment finalized stage=finalize batch=%s claim=%s endpoint=%s revision=%d',
                batchId,
                claimId,
                endpointId,
                batch.revision,
            );
            this.response.body = { ok: true, batchId: batchId.toHexString(), claimId, endpointId, revision: batch.revision };
        } catch (error) {
            if (!(error instanceof EndpointEnrollmentError)) throw error;
            this.reject(error, 'finalize', claimId);
        }
    }
}

export async function apply(ctx: Context) {
    ctx.Route('admin_endpoint_enrollment_batches', '/api/admin/endpoint-enrollment-batches', EndpointEnrollmentAdminHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route(
        'admin_endpoint_enrollment_batch_revoke',
        '/api/admin/endpoint-enrollment-batches/:batchId/revoke',
        EndpointEnrollmentBatchRevokeHandler,
        PRIV.PRIV_EDIT_SYSTEM,
    );
    ctx.Route(
        'admin_endpoint_credential_revoke',
        '/api/admin/endpoint-credentials/:endpointId/revoke',
        EndpointCredentialRevokeHandler,
        PRIV.PRIV_EDIT_SYSTEM,
    );
    ctx.Route('vigil_endpoint_enrollment_consume', '/api/vigil/endpoint-enrollment/consume', VigilEndpointEnrollmentConsumeHandler);
    ctx.Route('vigil_endpoint_enrollment_finalize', '/api/vigil/endpoint-enrollment/finalize', VigilEndpointEnrollmentFinalizeHandler);
}
