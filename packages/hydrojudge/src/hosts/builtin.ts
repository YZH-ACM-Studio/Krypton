// Hydro Integration

import path from 'path';
import { fs } from '@hydrooj/utils';
import * as sysinfo from '@hydrooj/utils/lib/sysinfo';
import {
    Context as HydroContext,
    db,
    JudgeHandler,
    JudgeResultCallbackContext,
    ObjectId,
    RecordModel,
    SettingModel,
    StorageModel,
    TaskModel,
} from 'hydrooj';
import { langs } from 'hydrooj/src/model/setting';
import { getConfig } from '../config';
import { SystemError } from '../error';
import { compilerVersions, stackSize } from '../info';
import { Session } from '../interface';
import { Context } from '../judge/interface';
import logger from '../log';
import { versionCheck } from '../sandbox';
import { JudgeTask } from '../task';
import { initTracing } from '../tracing';

const session: Session = {
    config: { detail: getConfig('detail') },
    async fetchFile(namespace, files) {
        if (namespace === null) {
            const name = Object.keys(files)[0].split('#')[0];
            const target = path.join(getConfig('tmp_dir'), name.replace(/\//g, '_'));
            await StorageModel.get(`submission/${name}`, target);
            return target as any;
        }
        for (const key in files) {
            const target = files[key];
            await StorageModel.get(`problem/${namespace}/testdata/${key}`, target);
        }
        return null;
    },
    getReporter(t: Context) {
        const reporter = new JudgeResultCallbackContext(app, t.request);
        return {
            next: (a) => reporter.next(a),
            end: (a) => reporter.end(a),
            wait: () => reporter.waitForOwnedTask(),
        };
    },
    getLang(lang: string, doThrow = true) {
        if (SettingModel.langs[lang]) return SettingModel.langs[lang];
        if (lang === 'cpp' && SettingModel.langs['cc']) return SettingModel.langs['cc'];
        if (doThrow) throw new SystemError('Unsupported language {0}.', [lang]);
        return null;
    },
    async postFile(target: string, filename: string, filepath: string) {
        return await JudgeHandler.processJudgeFileCallback(new ObjectId(target), filename, filepath);
    },
};

function collectCleanupError(errors: unknown[], error: unknown): void {
    if (error instanceof AggregateError) {
        for (const nested of error.errors) collectCleanupError(errors, nested);
        return;
    }
    if (!errors.includes(error)) errors.push(error);
}

async function settleCleanup(operations: Promise<unknown>[], message: string): Promise<void> {
    const results = await Promise.allSettled(operations);
    const errors: unknown[] = [];
    for (const result of results) {
        if (result.status === 'rejected') collectCleanupError(errors, result.reason);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, message);
}

export async function apply(ctx: HydroContext) {
    ctx.inject(['check'], (c) => {
        c.check.addChecker('Judge', async (_ctx, log, warn, error) => {
            await versionCheck(warn, error);
        });
    });
    const tracing = getConfig('tracing');
    if (tracing?.endpoint && tracing?.samplePercentage) {
        ctx.effect(() => {
            const sdk = initTracing(tracing.endpoint, tracing.samplePercentage);
            return () => sdk.shutdown();
        });
    }
    await fs.ensureDir(getConfig('tmp_dir'));
    const info = await sysinfo.get();
    const handle = async (t) => {
        const rdoc = await RecordModel.get(t.domainId, t.rid);
        if (!rdoc) {
            logger.debug('Record not found: %o', t);
            return;
        }
        await new JudgeTask(session, JSON.parse(JSON.stringify(Object.assign(rdoc, t)))).handle();
    };
    const parallelism = getConfig('parallelism');
    async function collectInfo() {
        const coll = db.collection('status');
        const [compilers, size] = await Promise.all([compilerVersions(langs), stackSize()]);
        await coll.updateOne({ mid: info.mid, type: 'server' }, { $set: { compilers, stackSize: size } }, { upsert: true });
    }
    const collectInfoOperations = new Set<Promise<void>>();
    function trackCollectInfo() {
        const operation = collectInfo();
        collectInfoOperations.add(operation);
        operation.then(
            () => collectInfoOperations.delete(operation),
            () => collectInfoOperations.delete(operation),
        );
        return operation;
    }
    await collectInfo();
    ctx.effect(() => {
        const taskConsumer = TaskModel.consume({ type: 'judge' }, handle, true, parallelism);
        const dispose = ctx.on('system/setting', () => {
            taskConsumer.setConcurrency(getConfig('parallelism'));
            return trackCollectInfo();
        });
        return () => {
            let listenerCleanup: Promise<unknown>;
            try {
                listenerCleanup = Promise.resolve(dispose());
            } catch (error) {
                listenerCleanup = Promise.reject(error);
            }
            return settleCleanup(
                [Promise.resolve().then(() => taskConsumer.destroy()), listenerCleanup, ...collectInfoOperations],
                'Builtin judge cleanup failed',
            );
        };
    });
    ctx.effect(() => {
        const generateConsumer = TaskModel.consume({ type: 'generate' }, handle);
        return () => generateConsumer.destroy();
    });
}
