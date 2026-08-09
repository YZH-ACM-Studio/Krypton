import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

function readSource(path: string) {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('in-process judge task ownership', () => {
    it('keeps remote-judge tasks owned until their callback context settles', () => {
        const source = readSource('packages/vjudge/src/index.ts');
        expect(source).to.include('await context.waitForOwnedTask();');
        expect(source).to.include('await end({ status: STATUS.STATUS_SYSTEM_ERROR, message: e.message });');
        expect(source).to.include("message: 'Remote judge did not return a submission ID'");
        expect(source).to.include("message: 'Remote judge returned without a terminal result'");
        expect(source).to.include('await this.mainPromise;');
        expect(source).to.include('Promise.resolve().then(() => this.consumer!.destroy())');
        expect(source).to.include('services.map((service) => Promise.resolve().then(() => service.stop()))');
        expect(source).not.to.include('for (const service of services) service.stop();');
    });

    it('wires the builtin judge reporter into JudgeTask settlement without swallowing failures', () => {
        const builtin = readSource('packages/hydrojudge/src/hosts/builtin.ts');
        const task = readSource('packages/hydrojudge/src/task.ts');
        expect(builtin).to.include('wait: () => reporter.waitForOwnedTask()');
        expect(builtin).to.include('await new JudgeTask(session, JSON.parse(JSON.stringify(Object.assign(rdoc, t)))).handle();');
        expect(builtin).to.include('Promise.resolve().then(() => taskConsumer.destroy())');
        expect(builtin).to.include('listenerCleanup = Promise.resolve(dispose())');
        expect(builtin).to.include('...collectInfoOperations');
        expect(builtin).to.include('await collectInfo();');
        expect(builtin).not.to.include('.handle().catch(logger.error)');
        expect(builtin).not.to.include('taskConsumer.destroy();');
        expect(task).to.include('await this.wait?.();');
    });
});
