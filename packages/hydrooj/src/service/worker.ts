import cac from 'cac';
import moment from 'moment-timezone';
import { sleep } from '@hydrooj/utils';
import { Context, Service } from '../context';
import db from './db';

declare module 'cordis' {
    interface Context {
        worker: WorkerService;
    }
}

const argv = cac().parse();

export default class WorkerService extends Service {
    private handlers: Record<string, Function> = {};
    consuming = true;
    running = null;
    promise: Promise<any> = null;
    coll = db.collection('schedule');

    constructor(ctx: Context) {
        super(ctx, 'worker');
    }

    *[Service.init]() {
        if (argv.options.disableWorker) return;
        this.consume();
        yield () => {
            this.consuming = false;
            return this.promise;
        };
    }

    async getFirst() {
        if (process.env.CI) return null;
        const q = {
            executeAfter: { $lt: new Date() },
            type: 'schedule',
            subType: { $in: Object.keys(this.handlers) },
        };
        // Contest auto-unhide is a persisted visibility transition. Claim it
        // by atomically moving the same task into a short retry window instead
        // of deleting it before the handler has read the authoritative
        // contest. This also upgrades tasks created before retry metadata was
        // introduced and avoids catch-up loops based on a stale executeAfter.
        if (this.handlers.contest) {
            const contestUnhide = await this.coll.findOneAndUpdate(
                { ...q, subType: 'contest', operation: 'unhide' },
                { $set: { executeAfter: new Date(Date.now() + 60_000), interval: [1, 'minute'] } },
                { returnDocument: 'before', sort: { executeAfter: 1 } },
            );
            if (contestUnhide) {
                this.ctx.logger.debug('%o', contestUnhide);
                return contestUnhide;
            }
        }
        const res = await this.coll.findOneAndDelete(q);
        if (res) {
            this.ctx.logger.debug('%o', res);
            if (res.interval) {
                const executeAfter = moment(res.executeAfter)
                    .add(...res.interval)
                    .toDate();
                await this.coll.insertOne({ ...res, executeAfter });
            }
            return res;
        }
        return null;
    }

    async consume() {
        while (this.consuming) {
            try {
                const doc = await this.getFirst();
                if (!doc) {
                    await sleep(1000);
                    continue;
                }
                this.running = doc;
                this.ctx.logger.debug('Worker task: %o', doc);
                const start = Date.now();
                this.promise = Promise.race([
                    this.handlers[doc.subType](doc).catch((e) => {
                        this.ctx.logger.error('Worker task fail: ', e);
                        this.ctx.logger.error('%o', doc);
                    }),
                    sleep(1200000),
                ]);

                await this.promise;
                const spent = Date.now() - start;
                if (spent > 500) this.ctx.logger.warn('Slow worker task (%d ms): %o', spent, doc);
                this.running = null;
            } catch (err) {
                this.ctx.logger.error(err);
            }
        }
    }

    public addHandler(type: string, handler: Function) {
        this.ctx.effect(() => {
            this.handlers[type] = handler;
            return () => {
                delete this.handlers[type];
            };
        });
    }
}
