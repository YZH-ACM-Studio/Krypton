import { BSON, Db, Filter, ObjectId, OnlyFieldsOfType } from 'mongodb';
import type { ConnectionHandler, Handler } from '@hydrooj/framework';
import pm2 from '@hydrooj/utils/lib/locate-pm2';
import { Context } from '../context';
import type {
    BaseUserDict,
    ContestBalloonDoc,
    DiscussionDoc,
    DomainDoc,
    FileInfo,
    MessageDoc,
    ProblemDict,
    ProblemDoc,
    RecordDoc,
    ScoreboardRow,
    Tdoc,
    TrainingDoc,
    User,
} from '../interface';
import type { DocType } from '../model/document';

export type Disposable = () => void;
export type VoidReturn = Promise<any> | any;

export interface EventMap {
    'app/listen': () => void;
    'app/started': () => void;
    'app/ready': () => VoidReturn;
    'app/exit': () => VoidReturn;
    'app/before-reload': (entries: Set<string>) => VoidReturn;
    'app/reload': (entries: Set<string>) => VoidReturn;

    'subscription/init': (h: ConnectionHandler, privileged: boolean) => VoidReturn;
    'subscription/subscribe': (channel: string, user: User, metadata: Record<string, string>) => VoidReturn;
    'subscription/enable': (channel: string, h: ConnectionHandler, privileged: boolean, onDispose: (disposable: () => void) => void) => VoidReturn;

    'app/watch/change': (path: string) => VoidReturn;
    'app/watch/unlink': (path: string) => VoidReturn;

    'database/connect': (db: Db) => void;
    'database/config': () => VoidReturn;

    'system/setting': (args: Record<string, any>) => VoidReturn;
    'system/setting-loaded': () => VoidReturn;
    'bus/broadcast': (event: keyof EventMap, payload: any, trace?: string) => VoidReturn;
    'monitor/update': (type: 'server' | 'judge', $set: any) => VoidReturn;
    'monitor/collect': (info: any) => VoidReturn;
    'api/update': () => void;
    'task/daily': () => void;
    'task/daily/finish': (pref: Record<string, number>) => void;

    'user/message': (uid: number[], mdoc: Omit<MessageDoc, 'to'>) => void;
    'user/get': (udoc: User) => void;
    'user/delcache': (content: string | true) => void;

    'user/import/parse': (payload: any) => VoidReturn;
    'user/import/create': (uid: number, udoc: any) => VoidReturn;

    'domain/create': (ddoc: DomainDoc) => VoidReturn;
    'domain/before-get': (query: Filter<DomainDoc>) => VoidReturn;
    'domain/get': (ddoc: DomainDoc) => VoidReturn;
    'domain/before-update': (domainId: string, $set: Partial<DomainDoc>) => VoidReturn;
    'domain/update': (domainId: string, $set: Partial<DomainDoc>, ddoc: DomainDoc) => VoidReturn;
    'domain/delete': (domainId: string) => VoidReturn;
    'domain/delete-cache': (domainId: string) => VoidReturn;

    'document/add': (doc: any) => VoidReturn;
    'document/set': <T extends keyof DocType>(
        domainId: string,
        docType: T,
        docId: DocType[T],
        $set: any,
        $unset: OnlyFieldsOfType<DocType[T], any, true | '' | 1>,
    ) => VoidReturn;

    'discussion/before-add': (payload: Partial<DiscussionDoc>) => VoidReturn;
    'discussion/add': (payload: Partial<DiscussionDoc>) => VoidReturn;

    'problem/before-add': (domainId: string, content: string, owner: number, docId: number, doc: Partial<ProblemDoc>) => VoidReturn;
    'problem/add': (doc: Partial<ProblemDoc>, docId: number) => VoidReturn;
    'problem/before-edit': (doc: Partial<ProblemDoc>, $unset: OnlyFieldsOfType<ProblemDoc, any, true | '' | 1>) => VoidReturn;
    'problem/edit': (doc: ProblemDoc, writeClaimRequestId?: string, previous?: { hidden?: boolean }) => VoidReturn;
    'problem/before-del': (
        domainId: string,
        docId: number,
        writeClaimRequestId?: string,
        context?: {
            kind: 'managed-draft-creation-cleanup';
            creator: number;
            owner: number;
            documentId: ObjectId;
            publicPid: string;
            writeClaimRequestId?: string;
        },
    ) => VoidReturn;
    'problem/list': (query: Filter<ProblemDoc>, handler: any, sort?: string[]) => VoidReturn;
    'problem/get': (doc: ProblemDoc, handler: any) => VoidReturn;
    'problem/delete': (domainId: string, docId: number) => VoidReturn;
    'problem/addTestdata': (domainId: string, docId: number, name: string, payload: Omit<FileInfo, '_id'>, claim?: any) => VoidReturn;
    'problem/renameTestdata': (domainId: string, docId: number, name: string, newName: string, claim?: any) => VoidReturn;
    'problem/delTestdata': (domainId: string, docId: number, name: string[], claim?: any) => VoidReturn;
    'problem/addAdditionalFile': (domainId: string, docId: number, name: string, payload: Omit<FileInfo, '_id'>, claim?: any) => VoidReturn;
    'problem/renameAdditionalFile': (domainId: string, docId: number, name: string, newName: string, claim?: any) => VoidReturn;
    'problem/delAdditionalFile': (domainId: string, docId: number, name: string[], claim?: any) => VoidReturn;

    'contest/before-add': (payload: Partial<Tdoc>) => VoidReturn;
    'contest/add': (payload: Partial<Tdoc>, id: ObjectId) => VoidReturn;
    'contest/before-edit': (tdoc: Tdoc, $set: Partial<Tdoc>) => VoidReturn;
    'contest/edit': (payload: Tdoc, domainId?: string, tid?: ObjectId, res?: any) => VoidReturn;
    'contest/list': (query: Filter<Tdoc>, handler: any) => VoidReturn;
    'contest/scoreboard': (tdoc: Tdoc, rows: ScoreboardRow[], udict: BaseUserDict, pdict: ProblemDict) => VoidReturn;
    'contest/balloon': (domainId: string, tid: ObjectId, bdoc: ContestBalloonDoc) => VoidReturn;
    'contest/del': (domainId: string, tid: ObjectId) => VoidReturn;

    'oplog/log': (type: string, handler: Handler | ConnectionHandler, args: any, data: any) => VoidReturn;

    'training/list': (query: Filter<TrainingDoc>, handler: any) => VoidReturn;
    'training/get': (tdoc: TrainingDoc, handler: any) => VoidReturn;

    'record/change': (rdoc: RecordDoc, $set?: any, $push?: any, body?: any) => void;
    'record/judge': (rdoc: RecordDoc, updated: boolean, pdoc?: ProblemDoc, updater?: any) => VoidReturn;
}

/**
 * Dispatch every listener and wait until all of them settle before reporting
 * failures. Cordis `parallel()` uses fail-fast `Promise.all()`, which is not
 * suitable for mutations whose observers may still be writing state.
 */
export async function parallelAllSettled<K extends keyof EventMap>(event: K, ...args: Parameters<EventMap[K]>): Promise<void> {
    const dispatchArgs: any[] = [event, ...args];
    const listeners = app.events.dispatch('emit', dispatchArgs);
    const results = await Promise.allSettled(listeners.map((listener) => Promise.resolve().then(() => listener(...dispatchArgs))));
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length === 1) throw failures[0].reason;
    if (failures.length > 1) {
        throw new AggregateError(
            failures.map((failure) => failure.reason),
            `Multiple observers failed for ${String(event)}`,
        );
    }
}

export function apply(ctx: Context) {
    try {
        if (!process.send || !pm2 || process.env.exec_mode !== 'cluster_mode') throw new Error('not in cluster mode');
        pm2.launchBus((err, bus) => {
            if (err) throw new Error('cannot launch pm2 bus');
            bus.on('hydro:broadcast', (packet) => {
                (app.parallel as any)(packet.data.event, ...BSON.EJSON.parse(packet.data.payload));
            });
            ctx.on('bus/broadcast', (event, payload) => {
                process.send({ type: 'hydro:broadcast', data: { event, payload: BSON.EJSON.stringify(payload) } });
            });
            console.debug('Using pm2 event bus');
        });
    } catch (e) {
        ctx.on('bus/broadcast', (event, payload) => app.parallel(event, ...payload));
        console.debug('Using mongodb external event bus');
    }
}

export default app;

global.bus = app;
