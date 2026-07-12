import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import type { BindingNotificationDependencies } from '../src/binding-notification';
import type { BindingRequest } from '../src/types';

function loadBindingNotificationModule() {
    const Module = require('module');
    const originalLoad = Module._load;
    Module._load = function load(request: string, parent: unknown, isMain: boolean) {
        if (request === 'hydrooj') {
            return {
                db: { collection: () => ({}) },
                MessageModel: { FLAG_UNREAD: 1, FLAG_I18N: 16, send: async () => undefined },
                ObjectId,
                PRIV: { PRIV_EDIT_SYSTEM: 1 },
                UserModel: { getMulti: () => ({ toArray: async () => [] }), getById: async () => null },
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        const dbPath = require.resolve('../src/db');
        const modulePath = require.resolve('../src/binding-notification');
        delete require.cache[dbPath];
        delete require.cache[modulePath];
        return require(modulePath);
    } finally {
        Module._load = originalLoad;
    }
}

const { buildBindingNotificationContent, notifyBindingRequest } = loadBindingNotificationModule();

function requestFixture(): BindingRequest {
    return {
        _id: new ObjectId(),
        domainId: 'system',
        userId: 42,
        studentIdInput: '20260001',
        realNameInput: '测试学生',
        schoolId: new ObjectId(),
        status: 'pending',
        createdAt: new Date('2026-07-13T00:00:00Z'),
        reviewedBy: null,
        reviewedAt: null,
        rejectReason: null,
        sourceTokenId: null,
        targetUserGroupId: null,
        claimTempUserId: null,
    };
}

function fakeDependencies(request: BindingRequest, failFirstSend = false) {
    const state = {
        claimed: false,
        notified: false,
        sendAttempts: 0,
        successfulSends: 0,
        releases: 0,
        staleBefore: null as Date | null,
        content: '',
        recipients: [] as number[],
    };
    const now = new Date('2026-07-13T01:00:00Z');
    const dependencies: BindingNotificationDependencies = {
        now: () => new Date(now),
        claim: async (_requestId, _claimedAt, staleBefore) => {
            state.staleBefore = staleBefore;
            if (state.claimed || state.notified) return null;
            state.claimed = true;
            return request;
        },
        listAdminRecipients: async () => [2, 7],
        getApplicantName: async (domainId, userId) => {
            expect(domainId).to.equal('system');
            expect(userId).to.equal(42);
            return 'applicant';
        },
        send: async (recipients, content) => {
            state.sendAttempts += 1;
            state.recipients = recipients;
            state.content = content;
            if (failFirstSend && state.sendAttempts === 1) throw new Error('message insert failed');
            state.successfulSends += 1;
        },
        markNotified: async () => {
            if (!state.claimed || state.notified) return { matchedCount: 0 };
            state.claimed = false;
            state.notified = true;
            return { matchedCount: 1 };
        },
        releaseClaim: async () => {
            if (!state.claimed || state.notified) return { matchedCount: 0 };
            state.claimed = false;
            state.releases += 1;
            return { matchedCount: 1 };
        },
    };
    return { dependencies, state };
}

describe('binding request notifications', () => {
    it('sends once to the administrator set and suppresses duplicate triggers', async () => {
        const request = requestFixture();
        const { dependencies, state } = fakeDependencies(request);

        expect(await notifyBindingRequest(request._id, dependencies)).to.equal(true);
        expect(await notifyBindingRequest(request._id, dependencies)).to.equal(false);
        expect(state.successfulSends).to.equal(1);
        expect(state.recipients).to.deep.equal([2, 7]);
        expect(state.staleBefore?.toISOString()).to.equal('2026-07-13T00:55:00.000Z');

        const payload = JSON.parse(state.content);
        expect(payload.message).to.include('{4:link}');
        expect(payload.params).to.deep.equal([
            'applicant',
            42,
            '20260001',
            '测试学生',
            '/admin/userbind/requests?status=pending',
        ]);
    });

    it('releases a failed claim so the next sweep can retry', async () => {
        const request = requestFixture();
        const { dependencies, state } = fakeDependencies(request, true);

        let failure: unknown;
        try {
            await notifyBindingRequest(request._id, dependencies);
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.an('error').with.property('message', 'message insert failed');
        expect(state.releases).to.equal(1);
        expect(state.notified).to.equal(false);

        expect(await notifyBindingRequest(request._id, dependencies)).to.equal(true);
        expect(state.successfulSends).to.equal(1);
        expect(state.notified).to.equal(true);
    });

    it('fails rather than marking notified when no administrator recipient exists', async () => {
        const request = requestFixture();
        const { dependencies, state } = fakeDependencies(request);
        dependencies.listAdminRecipients = async () => [];

        let failure: unknown;
        try {
            await notifyBindingRequest(request._id, dependencies);
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.an('error').with.property(
            'message',
            'No PRIV_EDIT_SYSTEM recipient exists for binding request notification',
        );
        expect(state.successfulSends).to.equal(0);
        expect(state.releases).to.equal(1);
        expect(state.notified).to.equal(false);
    });

    it('builds a domain-aware direct review link', () => {
        const request = requestFixture();
        request.domainId = 'class A';
        const payload = JSON.parse(buildBindingNotificationContent(request, 'applicant'));
        expect(payload.params[4]).to.equal('/d/class%20A/admin/userbind/requests?status=pending');
    });
});
