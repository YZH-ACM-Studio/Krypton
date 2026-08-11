import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { expect } from 'chai';
import { param } from '@hydrooj/framework/decorators';
import { Types } from '@hydrooj/framework/validator';

const handler = readFileSync(resolve(__dirname, '../src/handler/exam-network-execution.ts'), 'utf8');
const callback = readFileSync(resolve(__dirname, '../src/handler/vigil-integration.ts'), 'utf8');
const model = readFileSync(resolve(__dirname, '../src/model/exam-network-execution.ts'), 'utf8');

describe('exam network execution HTTP contracts', () => {
    it('keeps human execution control on the ExamEvent permission boundary', () => {
        expect(handler).to.include("'/api/admin/exam-events/:eventId/network-execution'");
        expect(handler).to.include('assertCanManageExamEvent(domainId, event, this.user)');
        expect(handler).to.include('withExamEventBoundary(domainId, eventId');
        expect(handler).to.include("Types.Range(['preflight', 'refresh', 'retry', 'retryFailed', 'start', 'stop'])");
        expect(handler).to.include('preflightConfig: {');
        expect(handler).to.include('revision: configured.configRevision');
        expect(handler).to.not.include("@param('expectedRevision', Types.UnsignedInt, true)");
        expect(handler).to.include("readUnsignedIntBody(this, 'expectedRevision')");
        expect(handler).to.include('configured.configRevision !== expectedConfigRevision');
        expect(handler).to.include("throw new ExamNetworkExecutionError('config_revision_conflict')");
        expect(handler).to.not.include('dashboardToken');
    });

    it('preserves a zero initial execution revision through the real param decorator', () => {
        class DecoratedRevisionProbe {
            request = { body: { action: 'start', expectedRevision: 0 }, query: {}, params: {} };

            @param('action', Types.Range(['start']))
            run(_args: unknown, action: 'start') {
                return {
                    action,
                    expectedRevision: this.request.body.expectedRevision,
                };
            }
        }

        const probe = new DecoratedRevisionProbe();
        const result = (probe.run as unknown as (rawArgs: Record<string, unknown>) => unknown)({
            domainId: 'system',
            action: 'start',
            expectedRevision: 0,
        });
        expect(result).to.deep.equal({ action: 'start', expectedRevision: 0 });
    });

    it('persists intent before dispatch and distinguishes delivery-unknown from definite rejection', () => {
        const mutation = handler.indexOf('examNetworkExecutionService.beginApply');
        const dispatch = handler.indexOf('await dispatchExamNetworkOnVigil');
        expect(mutation).to.be.greaterThan(-1);
        expect(dispatch).to.be.greaterThan(mutation);
        expect(handler).to.include('examNetworkExecutionService.markUnknown');
        expect(handler).to.include('examNetworkExecutionService.markFailed');
        expect(handler).to.include('classifyVigilBridgeFailure(error)');
        expect(model).to.include('projection_revision_conflict');
        expect(handler).to.include('examNetworkExecutionService.beginRetry');
        expect(handler).to.include("retryMode: 'full_target'");
        expect(handler).to.include("throw new ExamNetworkExecutionError('retry_requires_current_config')");
    });

    it('accepts callbacks only through the existing Vigil service-token handler', () => {
        const base = callback.indexOf('class VigilApiHandler');
        const projection = callback.indexOf('class VigilExamNetworkProjectionHandler extends VigilApiHandler');
        const route = callback.indexOf("'/api/vigil/exam-network/projection'");
        expect(base).to.be.greaterThan(-1);
        expect(projection).to.be.greaterThan(base);
        expect(route).to.be.greaterThan(projection);
        expect(callback).to.include("requireServiceToken(this, 'vigil')");
        expect(callback).to.include('examNetworkExecutionService.applyProjection(projection)');
    });
});
