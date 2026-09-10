import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { expect } from 'chai';

const source = readFileSync(resolve(__dirname, '../src/handler/endpoint-enrollment.ts'), 'utf8');
const serviceTokenSource = readFileSync(resolve(__dirname, '../src/lib/service-token.ts'), 'utf8');

function routeRegistration(name: string): string {
    const nameIndex = source.indexOf(`'${name}'`);
    expect(nameIndex).to.be.greaterThan(-1);
    const start = source.lastIndexOf('ctx.Route(', nameIndex);
    const end = source.indexOf(');', nameIndex);
    expect(start).to.be.greaterThan(-1);
    expect(end).to.be.greaterThan(nameIndex);
    return source.slice(start, end + 2);
}

describe('endpoint enrollment HTTP boundary', () => {
    it('gates every administrator mutation with the system privilege', () => {
        expect(source).to.include('this.checkPriv(PRIV.PRIV_EDIT_SYSTEM)');
        expect(routeRegistration('admin_endpoint_enrollment_batches')).to.include('EndpointEnrollmentAdminHandler');
        expect(routeRegistration('admin_endpoint_enrollment_batches')).to.include('PRIV.PRIV_EDIT_SYSTEM');
        expect(routeRegistration('admin_endpoint_enrollment_batch_revoke')).to.include('EndpointEnrollmentBatchRevokeHandler');
        expect(routeRegistration('admin_endpoint_enrollment_batch_revoke')).to.include('PRIV.PRIV_EDIT_SYSTEM');
        expect(routeRegistration('admin_endpoint_credential_revoke')).to.include('EndpointCredentialRevokeHandler');
        expect(routeRegistration('admin_endpoint_credential_revoke')).to.include('PRIV.PRIV_EDIT_SYSTEM');
    });

    it('requires the Vigil service channel for consume and finalize', () => {
        expect(source).to.include("requireServiceToken(this, 'vigil')");
        expect(source).not.to.include('ensureIndexes()');
        expect(source).to.include("'/api/vigil/endpoint-enrollment/consume'");
        expect(source).to.include("'/api/vigil/endpoint-enrollment/finalize'");
    });

    it('allows Vigil to ensure only deterministic machine registrations', () => {
        expect(source).to.include("'/api/vigil/endpoint-registrations/ensure'");
        expect(source).to.include('endpointRegistrationService.ensure({ endpointId, machineFingerprint })');
        expect(source).to.include("exactBody(this.request.body, ['endpointId', 'machineFingerprint'])");
        expect(source).to.include("requireServiceToken(this, 'vigil')");
    });

    it('keeps the raw decorator argument separate from canonical parameters', () => {
        expect(source).to.match(/async post\(_args: unknown, expiresAt: string, maxEnrollments: number, replacesEndpointId = ''\)/);
        expect(source).to.match(/async post\(_args: unknown, batchId: ObjectId, expectedRevision: number\)/);
        expect(source).to.match(/async post\(_args: unknown, batchId: ObjectId, claimId: string, endpointId: string\)/);
    });

    it('never records the enrollment code in Oplog or structured logs', () => {
        const createOplog = source.slice(
            source.indexOf("OplogModel.log(this, 'endpoint.enrollment_batch.create'"),
            source.indexOf('this.response.body = {', source.indexOf("OplogModel.log(this, 'endpoint.enrollment_batch.create'")),
        );
        expect(createOplog).not.to.include('enrollmentCode');
        for (const line of source.split('\n').filter((candidate) => candidate.includes('logger.'))) {
            expect(line).not.to.include('enrollmentCode');
        }
        expect(serviceTokenSource).not.to.include('.slice(0, 8)');
        expect(serviceTokenSource).not.to.match(/logger\.[a-z]+\([^\n]*prefix/);
    });
});
