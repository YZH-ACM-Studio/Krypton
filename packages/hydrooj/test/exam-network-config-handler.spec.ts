import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { expect } from 'chai';

const source = readFileSync(resolve(__dirname, '../src/handler/exam-network-config.ts'), 'utf8');
const eventSource = readFileSync(resolve(__dirname, '../src/handler/exam-event.ts'), 'utf8');
const modelSource = readFileSync(resolve(__dirname, '../src/model/exam-network-config.ts'), 'utf8');
const auditSource = readFileSync(resolve(__dirname, '../src/model/exam-network-audit.ts'), 'utf8');

describe('Exam network control HTTP contracts', () => {
    it('exposes only the narrow OJ canonical routes and no execution/UI shortcut', () => {
        for (const route of [
            '/api/admin/exam-policy-templates',
            '/api/admin/exam-policy-templates/:templateId',
            '/api/admin/exam-events/:eventId/target-assignment',
            '/api/admin/exam-events/:eventId/network-config',
        ]) {
            expect(source).to.include(route);
        }
        for (const forbidden of ['send_command', 'apply_network_policy', 'dashboardToken', '/api/integrations/oj/network-lock']) {
            expect(source).not.to.include(forbidden);
        }
    });

    it('rechecks event/template/school permissions and never accepts browser endpoint facts', () => {
        expect(source).to.include('assertCanManageExamEvent');
        expect(source).to.include('loadTemplateForEvent');
        expect(source).to.include('assertExamEventCollaborators');
        expect(source).to.include('requireExamTargetResolver()');
        expect(source).not.to.match(/body\.(endpoints|endpointIds|capabilities)/);
        expect(modelSource).to.include("throw new ExamNetworkConfigError('cross_school_endpoint')");
        expect(modelSource).to.include("throw new ExamNetworkConfigError('endpoint_capability_missing')");
    });

    it('uses raw decorator placeholders, action dispatch and CAS at every mutation boundary', () => {
        expect(source).not.to.include("@param('operation'");
        expect(source).to.match(/async post\(\s*_args: unknown,/);
        expect(source).to.include("@param('action', Types.Range(['saveDraft', 'publish', 'archive']))");
        expect(source).to.include("@param('action', Types.Range(['saveDraft', 'preview', 'publish']))");
        expect(source).to.include("@param('action', Types.Range(['assignPolicy', 'assignTarget']))");
        expect(source.match(/expectedRevision/g)?.length).to.be.greaterThan(10);
        expect(source.match(/this\.assertEventWritable\(event\)/g)).to.have.length(4);
        expect(source.match(/@serializedExamEventWrite/g)).to.have.length(4);
        expect(eventSource).to.include('withExamEventBoundary(domainId, eventId');
    });

    it('creates an audit intent before every write and logs immutable identities without endpoint commands', () => {
        expect(source).to.include('runAuditedExamNetworkMutation(');
        expect(auditSource).to.include("result: 'started'");
        expect(auditSource).to.include("result: 'success'");
        expect(auditSource).to.include("result: 'failed'");
        expect(auditSource).to.include('fingerprint: input.fingerprint');
        expect(auditSource).to.include('targetCount: input.targetCount');
        expect(source).to.include('policyTemplateAuditFacts(action, template)');
        expect(source).to.include('targetAssignmentAuditFacts(action, assignment)');
    });
});
