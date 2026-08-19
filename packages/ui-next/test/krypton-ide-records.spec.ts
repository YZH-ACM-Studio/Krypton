import { describe, expect, it } from 'vitest';
import { buildProblemRecordsHref, extractRecordListPayload, mergeIdeRecordSnapshot } from '../src/pages/problem-detail.tsx';

describe('krypton IDE submission records', () => {
  it('does not let an older local pending snapshot replace a terminal live update', () => {
    const terminal = {
      rid: 'record-2',
      url: '/record/record-2',
      lang: 'cc.cc17',
      status: 2,
      time: 3,
      memory: 128,
      timestamp: 2,
    };
    const stalePending = {
      ...terminal,
      status: 20,
      time: undefined,
      memory: undefined,
    };
    const nextPending = {
      rid: 'record-3',
      url: '/record/record-3',
      lang: 'cc.cc17',
      status: 20,
      timestamp: 3,
    };

    const merged = mergeIdeRecordSnapshot([terminal], [nextPending, stalePending]);

    expect(merged.find((record) => record.rid === 'record-2')).toMatchObject({
      status: 2,
      time: 3,
      memory: 128,
    });
    expect(merged.find((record) => record.rid === 'record-3')?.status).to.equal(20);
  });

  it('still accepts a terminal polling update for a pending local record', () => {
    const pending = {
      rid: 'record-4',
      url: '/record/record-4',
      lang: 'cc.cc17',
      status: 20,
      timestamp: 4,
    };
    const terminal = { ...pending, status: 1, time: 2, memory: 64 };

    expect(mergeIdeRecordSnapshot([pending], [terminal])[0]).toMatchObject({ status: 1, time: 2, memory: 64 });
  });

  it('keeps a format-error websocket result when an older list response returns pending', () => {
    const formatError = {
      rid: 'record-5',
      url: '/record/record-5',
      lang: 'cc.cc17',
      status: 31,
      score: 0,
      timestamp: 5,
    };
    const stalePending = { ...formatError, status: 20, score: undefined };

    expect(mergeIdeRecordSnapshot([formatError], [stalePending])[0]).toMatchObject({ status: 31, score: 0 });
  });

  it('fills record list URLs with pid, tid and the current user', () => {
    expect(
      buildProblemRecordsHref({
        recordsBase: '/record',
        docId: 42,
        pid: 'P0042',
        tid: '6a85208aa896bb67934b3bf7',
        practice: true,
        uidOrName: 7,
      }),
    ).to.equal('/record?pid=42&tid=6a85208aa896bb67934b3bf7&practice=true&uidOrName=7');
    expect(buildProblemRecordsHref({ recordsBase: '/record', pid: 'P0042', status: 1 })).to.equal('/record?pid=P0042&status=1');
  });

  it('reads rdocs from the raw JSON body or the UINext page wrapper', () => {
    expect(extractRecordListPayload({ rdocs: [{ _id: 'a' }] })).to.deep.equal([{ _id: 'a' }]);
    expect(extractRecordListPayload({ page: { data: { rdocs: [{ _id: 'b' }] } } })).to.deep.equal([{ _id: 'b' }]);
    expect(extractRecordListPayload({ data: { rdocs: [{ _id: 'c' }] } })).to.deep.equal([{ _id: 'c' }]);
    expect(extractRecordListPayload({})).to.deep.equal([]);
  });
});
