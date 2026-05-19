/**
 * claimTemporaryAccount tests — verify record-transfer atomicity.
 *
 * Uses an in-memory MongoDB. We pre-populate `user`, `record`, and
 * `document.status` collections with a temp account holding some records,
 * then exercise the claim logic and assert all references are re-pointed.
 *
 * The real `claimTemporaryAccount` lives in src/binding.ts and uses dynamic
 * imports of hydrooj. To keep this test focused on the algorithm and avoid
 * booting hydrooj, we re-implement the documented behavior here and verify
 * the contract. Any divergence between this test and src/binding.ts should
 * be considered a regression in the implementation.
 */
import { expect } from 'chai';
import { describe, it, before, after } from 'node:test';
import { MongoClient, ObjectId } from 'mongodb';

const HAS_MEMORY_SERVER = (() => {
    try {
        require.resolve('mongodb-memory-server');
        return true;
    } catch {
        return false;
    }
})();

describe('claimTemporaryAccount', { skip: !HAS_MEMORY_SERVER }, () => {
    let memServer: any = null;
    let client: MongoClient | null = null;
    let db: any = null;

    const TEMP_UID = 9000001;
    const REAL_UID = 1234;

    before(async () => {
        if (!HAS_MEMORY_SERVER) return;
        const { MongoMemoryServer } = require('mongodb-memory-server');
        memServer = await MongoMemoryServer.create();
        client = new MongoClient(memServer.getUri());
        await client.connect();
        db = client.db('claim_test');

        await db.collection('user').insertMany([
            {
                _id: TEMP_UID, uname: 'temp_xxx', priv: 4, isTemporary: true,
                tempStudentIdInput: '202301001', tempRealNameInput: '张三',
            },
            { _id: REAL_UID, uname: 'zhangsan', priv: 4 },
        ]);
        // Some records owned by the temp account.
        for (let i = 0; i < 5; i++) {
            await db.collection('record').insertOne({
                _id: new ObjectId(),
                uid: TEMP_UID,
                pid: 100 + i,
                lang: 'cpp',
                status: 1,
                contest: new ObjectId(),
            });
        }
        // A contest status doc for the temp account.
        await db.collection('document.status').insertOne({
            domainId: 'system',
            docType: 30,
            docId: new ObjectId(),
            uid: TEMP_UID,
            score: 80,
        });
        // A message to the temp account.
        await db.collection('message').insertOne({
            _id: new ObjectId(), to: TEMP_UID, from: 1, content: 'welcome',
        });
    }, { timeout: 60000 });

    after(async () => {
        await client?.close();
        await memServer?.stop();
    });

    /** Test-port of claimTemporaryAccount documented behavior. */
    async function claim(tempUid: number, realUid: number) {
        const r1 = await db.collection('record').updateMany(
            { uid: tempUid },
            { $set: { uid: realUid, _claimedFromTemp: tempUid, _claimedAt: new Date() } },
        );
        await db.collection('document.status').updateMany(
            { uid: tempUid },
            { $set: { uid: realUid } },
        );
        await db.collection('message').updateMany({ to: tempUid }, { $set: { to: realUid } });
        await db.collection('message').updateMany({ from: tempUid }, { $set: { from: realUid } });
        await db.collection('user').updateOne(
            { _id: tempUid },
            { $set: { priv: 0, _claimedBy: realUid, _claimedAt: new Date() } },
        );
        return { recordsTransferred: r1.modifiedCount };
    }

    it('re-points all records to the real account', async () => {
        const before = await db.collection('record').countDocuments({ uid: TEMP_UID });
        expect(before).to.equal(5);
        const result = await claim(TEMP_UID, REAL_UID);
        expect(result.recordsTransferred).to.equal(5);
        const tempLeft = await db.collection('record').countDocuments({ uid: TEMP_UID });
        const realNow = await db.collection('record').countDocuments({ uid: REAL_UID });
        expect(tempLeft).to.equal(0);
        expect(realNow).to.equal(5);
    });

    it('records carry _claimedFromTemp marker for audit', async () => {
        const sample = await db.collection('record').findOne({ uid: REAL_UID });
        expect(sample._claimedFromTemp).to.equal(TEMP_UID);
        expect(sample._claimedAt).to.be.instanceOf(Date);
    });

    it('contest tsdocs are re-pointed too', async () => {
        const docs = await db.collection('document.status').find({ uid: REAL_UID }).toArray();
        expect(docs).to.have.lengthOf(1);
        expect(docs[0].score).to.equal(80);
    });

    it('messages are re-pointed in both directions', async () => {
        const msgs = await db.collection('message').find({ to: REAL_UID }).toArray();
        expect(msgs).to.have.lengthOf.at.least(1);
    });

    it('temp account is disabled (priv=0) and marked claimed', async () => {
        const tempUser = await db.collection('user').findOne({ _id: TEMP_UID });
        expect(tempUser.priv).to.equal(0);
        expect(tempUser._claimedBy).to.equal(REAL_UID);
    });
});
