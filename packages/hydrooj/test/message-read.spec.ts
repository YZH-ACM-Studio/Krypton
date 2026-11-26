import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { MongoClient, ObjectId } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';

const Module = require('node:module');
let mongo: MongoMemoryServer;
let client: MongoClient;
let messages: typeof import('../src/model/message').default;
const shared = new ObjectId();
const other = new ObjectId();
const outgoing = new ObjectId();

before(async () => {
    mongo = await MongoMemoryServer.create({ binary: { version: '8.2.1' } });
    client = new MongoClient(mongo.getUri());
    await client.connect();
    const db = client.db('message_read');
    await db.collection('message').insertMany([
        { _id: shared, from: 1, to: [2, 3], flag: 5, content: 'shared notification' },
        { _id: other, from: 1, to: [3], flag: 1, content: 'another recipient' },
        { _id: outgoing, from: 2, to: [3], flag: 1, content: 'outgoing' },
    ]);
    const originalLoad = Module._load;
    global.Hydro = { model: {} } as typeof global.Hydro;
    try {
        Module._load = function load(request: string, parent: { filename?: string }, isMain: boolean) {
            if (parent?.filename?.endsWith('/model/message.ts')) {
                if (request === '../service/db') return { collection: (name: string) => db.collection(name), ensureIndexes() {} };
                if (request === '../service/bus') return { broadcast() {} };
                if (request === '../utils') return { ArgMethod() {} };
                if (request === './system') return {};
                if (request === './user') {
                    return {
                    setById: (uid: number, values: object) => db.collection('user').updateOne({ uid }, { $set: values }, { upsert: true }),
                    };
                }
            }
            return originalLoad.call(this, request, parent, isMain);
        };
        messages = require('../src/model/message').default;
    } finally {
        Module._load = originalLoad;
    }
});

after(async () => {
    await client?.close();
    await mongo?.stop();
});

it('persists per-recipient reads, rejects unrelated IDs and keeps other recipients unread', async () => {
    assert.deepEqual(await messages.markRead(2, [shared, other, outgoing]), { updated: 1, unreadMsg: 0 });
    assert.deepEqual(await messages.markRead(2, [shared]), { updated: 0, unreadMsg: 0 });
    const read = (await messages.getByUser(2)).find((message) => message._id.equals(shared));
    assert.equal(read?.flag, 4);
    assert.equal('readBy' in read!, false);
    const recipient = await messages.getByUser(3);
    assert.equal(recipient.find((message) => message._id.equals(shared))?.flag, 5);
    assert.equal(recipient.find((message) => message._id.equals(other))?.flag, 1);
    assert.equal(recipient.find((message) => message._id.equals(outgoing))?.flag, 1);
    const persisted = await client.db('message_read').collection('message').findOne({ _id: shared });
    assert.deepEqual(persisted?.readBy, [2]);
    // A new database connection represents a new process; reads are not session storage.
    const fresh = new MongoClient(mongo.getUri());
    try {
        await fresh.connect();
        assert.deepEqual((await fresh.db('message_read').collection('message').findOne({ _id: shared }))?.readBy, [2]);
    } finally {
        await fresh.close();
    }
    assert.deepEqual(await messages.markRead(3, [shared]), { updated: 1, unreadMsg: 2 });
    await messages.del(other);
    assert.equal(await messages.countUnread(3), 1);
});

it('counts the same recent-message window as the inbox without altering older read facts', async () => {
    const coll = client.db('message_read').collection('message');
    await coll.insertMany(Array.from({ length: 1001 }, () => ({ from: 1, to: [7], flag: 1, content: 'notice' })));
    const visible = await messages.getByUser(7);
    assert.equal(visible.length, 1000);
    assert.equal(await messages.countUnread(7), 1000);
    await messages.markRead(7, visible.map((item) => item._id));
    assert.equal(await messages.countUnread(7), 0);
    assert.equal(await coll.countDocuments({ to: 7, readBy: { $ne: 7 } }), 1);
});

it('projects the current count on normal and error pages without writing user counters', async () => {
    const hooks = new Map<string, (handler: { user: { _id: number; unreadMsg: number }; response: { template?: string } }) => Promise<void>>();
    await require('../src/model/message').apply({ on: (name: string, callback: typeof hooks extends Map<string, infer T> ? T : never) => hooks.set(name, callback) });
    const normal = { user: { _id: 3, unreadMsg: 999 }, response: { template: 'home.html' } };
    await hooks.get('handler/after')!(normal);
    assert.equal(normal.user.unreadMsg, 1);
    const error = { user: { _id: 3, unreadMsg: 999 }, response: {} };
    await hooks.get('handler/error')!(error);
    assert.equal(error.user.unreadMsg, 1);
    assert.equal(await client.db('message_read').collection('user').countDocuments(), 0);
});
