import { MessageModel, ObjectId, PRIV, UserModel } from 'hydrooj';
import { bindingRequestsColl } from './db';
import type { BindingRequest } from './types';

const NOTIFICATION_CLAIM_TTL_MS = 5 * 60 * 1000;
const NOTIFICATION_SWEEP_LIMIT = 100;

interface UpdateResult {
    matchedCount: number;
}

export interface BindingNotificationDependencies {
    now(): Date;
    claim(requestId: ObjectId, claimedAt: Date, staleBefore: Date): Promise<BindingRequest | null>;
    listAdminRecipients(): Promise<number[]>;
    getApplicantName(domainId: string, userId: number): Promise<string>;
    send(recipients: number[], content: string): Promise<unknown>;
    markNotified(requestId: ObjectId, claimedAt: Date, notifiedAt: Date): Promise<UpdateResult>;
    releaseClaim(requestId: ObjectId, claimedAt: Date): Promise<UpdateResult>;
}

function requestReviewUrl(domainId: string): string {
    const prefix = domainId === 'system' ? '' : `/d/${encodeURIComponent(domainId)}`;
    return `${prefix}/admin/userbind/requests?status=pending`;
}

export function buildBindingNotificationContent(request: BindingRequest, applicantName: string): string {
    return JSON.stringify({
        message: '新的绑定申请\n申请人：{0}（UID {1}）\n学号：{2}\n姓名：{3}\n查看申请：{4:link}',
        params: [
            applicantName,
            request.userId,
            request.studentIdInput,
            request.realNameInput,
            requestReviewUrl(request.domainId),
        ],
    });
}

const defaultDependencies: BindingNotificationDependencies = {
    now: () => new Date(),
    claim: (requestId, claimedAt, staleBefore) => bindingRequestsColl.findOneAndUpdate(
        {
            _id: requestId,
            status: 'pending',
            notifiedAt: null,
            $or: [
                { notifyClaimedAt: null },
                { notifyClaimedAt: { $lt: staleBefore } },
            ],
        },
        { $set: { notifyClaimedAt: claimedAt } },
        { returnDocument: 'after' },
    ),
    listAdminRecipients: async () => (await UserModel.getMulti(
        { priv: { $bitsAllSet: PRIV.PRIV_EDIT_SYSTEM } } as any,
        ['_id'],
    ).toArray()).map((user) => user._id),
    getApplicantName: async (domainId, userId) => {
        const applicant = await UserModel.getById(domainId, userId);
        if (!applicant) throw new Error(`Binding request applicant does not exist: domain=${domainId} uid=${userId}`);
        return applicant.uname;
    },
    send: (recipients, content) => MessageModel.send(
        1,
        recipients,
        content,
        MessageModel.FLAG_UNREAD | MessageModel.FLAG_I18N,
    ),
    markNotified: (requestId, claimedAt, notifiedAt) => bindingRequestsColl.updateOne(
        { _id: requestId, notifyClaimedAt: claimedAt },
        { $set: { notifiedAt }, $unset: { notifyClaimedAt: '' } },
    ),
    releaseClaim: (requestId, claimedAt) => bindingRequestsColl.updateOne(
        { _id: requestId, notifyClaimedAt: claimedAt, notifiedAt: null },
        { $unset: { notifyClaimedAt: '' } },
    ),
};

export async function notifyBindingRequest(
    requestId: ObjectId,
    dependencies: BindingNotificationDependencies = defaultDependencies,
): Promise<boolean> {
    const claimedAt = dependencies.now();
    const staleBefore = new Date(claimedAt.getTime() - NOTIFICATION_CLAIM_TTL_MS);
    const request = await dependencies.claim(requestId, claimedAt, staleBefore);
    if (!request) return false;

    try {
        const [recipients, applicantName] = await Promise.all([
            dependencies.listAdminRecipients(),
            dependencies.getApplicantName(request.domainId, request.userId),
        ]);
        if (!recipients.length) throw new Error('No PRIV_EDIT_SYSTEM recipient exists for binding request notification');
        await dependencies.send(recipients, buildBindingNotificationContent(request, applicantName));
        const marked = await dependencies.markNotified(requestId, claimedAt, dependencies.now());
        if (marked.matchedCount !== 1) {
            throw new Error(`Binding request notification claim was lost before completion: ${requestId}`);
        }
        return true;
    } catch (error) {
        const released = await dependencies.releaseClaim(requestId, claimedAt);
        if (released.matchedCount !== 1) {
            throw new AggregateError(
                [error, new Error(`Failed to release binding notification claim: ${requestId}`)],
                'Binding request notification failed and its claim could not be released',
            );
        }
        throw error;
    }
}

export async function sweepPendingBindingNotifications(): Promise<number> {
    const staleBefore = new Date(Date.now() - NOTIFICATION_CLAIM_TTL_MS);
    const requests = await bindingRequestsColl.find({
        status: 'pending',
        notifiedAt: null,
        $or: [
            { notifyClaimedAt: null },
            { notifyClaimedAt: { $lt: staleBefore } },
        ],
    }).project({ _id: 1 }).sort({ createdAt: 1 }).limit(NOTIFICATION_SWEEP_LIMIT).toArray();

    let notified = 0;
    const errors: unknown[] = [];
    for (const request of requests) {
        try {
            if (await notifyBindingRequest(request._id)) notified += 1;
        } catch (error) {
            errors.push(error);
            console.error('[krypton-userbind] binding notification delivery failed:', request._id, error);
        }
    }
    if (errors.length) throw new AggregateError(errors, 'One or more binding request notifications failed');
    return notified;
}
