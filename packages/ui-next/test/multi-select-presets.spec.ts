import { describe, expect, it, vi } from 'vitest';
import {
  COMMON_LANG_OPTIONS,
  fetchProblemsByIds,
  LANG_LABEL_MAP,
  problemKey,
  resolveLangs,
  searchProblems,
} from '../src/lib/multi-select-presets.ts';

const jsonResponse = (body: unknown, ok = true) => ({
  ok,
  json: () => Promise.resolve(body),
});

const stubFetch = (impl: (...args: unknown[]) => Promise<unknown>) => {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
};

const requestedUrl = (mock: ReturnType<typeof stubFetch>, callIndex = 0) => new URL(String(mock.mock.calls[callIndex][0]));

describe('language preset constants', () => {
  it('exposes one label per unique language id', () => {
    expect(Object.keys(LANG_LABEL_MAP).length).to.equal(COMMON_LANG_OPTIONS.length);
  });

  it('maps well-known hydro lang ids to display labels', () => {
    expect(LANG_LABEL_MAP['cc.cc20']).to.equal('C++20');
    expect(LANG_LABEL_MAP['py.py3']).to.equal('Python 3');
    expect(LANG_LABEL_MAP.java).to.equal('Java');
  });
});

describe('resolveLangs', () => {
  it('resolves known ids to their labels', () => {
    expect(resolveLangs(['cc.cc17', 'rs'])).to.deep.equal([
      { value: 'cc.cc17', label: 'C++17' },
      { value: 'rs', label: 'Rust' },
    ]);
  });

  it('falls back to the id as label for unknown ids', () => {
    expect(resolveLangs(['scratch'])).to.deep.equal([{ value: 'scratch', label: 'scratch' }]);
  });

  it('drops empty ids and handles empty input', () => {
    expect(resolveLangs(['', 'go', ''])).to.deep.equal([{ value: 'go', label: 'Go' }]);
    expect(resolveLangs([])).to.deep.equal([]);
  });
});

describe('searchProblems', () => {
  const pdoc = {
    docId: 1001,
    pid: 'P1001',
    title: 'A + B',
    tag: ['math'],
    difficulty: 3,
    nSubmit: 100,
    nAccept: 60,
    content: 'should be dropped',
    owner: 2,
  };

  it('queries the /p endpoint with q, quick, and limit parameters', async () => {
    const mock = stubFetch(async () => jsonResponse({ pdocs: [] }));
    await searchProblems('dp', 15);

    expect(mock.mock.calls.length).to.equal(1);
    const url = requestedUrl(mock);
    expect(url.pathname).to.equal('/p');
    expect(url.searchParams.get('q')).to.equal('dp');
    expect(url.searchParams.get('quick')).to.equal('true');
    expect(url.searchParams.get('limit')).to.equal('15');
    expect(mock.mock.calls[0][1]).to.deep.equal({ headers: { Accept: 'application/json' } });
  });

  it('defaults the limit to twenty and omits q for an empty query', async () => {
    const mock = stubFetch(async () => jsonResponse({ pdocs: [] }));
    await searchProblems('');

    const url = requestedUrl(mock);
    expect(url.searchParams.has('q')).to.equal(false);
    expect(url.searchParams.get('limit')).to.equal('20');
  });

  it('projects pdocs down to the ProblemOption shape', async () => {
    stubFetch(async () => jsonResponse({ pdocs: [pdoc] }));

    expect(await searchProblems('a+b')).to.deep.equal([{
      docId: 1001,
      pid: 'P1001',
      title: 'A + B',
      tag: ['math'],
      difficulty: 3,
      nSubmit: 100,
      nAccept: 60,
    }]);
  });

  it('returns an empty list on http errors', async () => {
    stubFetch(async () => jsonResponse({ pdocs: [pdoc] }, false));
    expect(await searchProblems('dp')).to.deep.equal([]);
  });

  it('returns an empty list on malformed json bodies', async () => {
    stubFetch(async () => ({ ok: true, json: () => Promise.reject(new SyntaxError('bad json')) }));
    expect(await searchProblems('dp')).to.deep.equal([]);
  });

  it('returns an empty list when pdocs is missing or not an array', async () => {
    stubFetch(async () => jsonResponse({ pdocs: 'nope' }));
    expect(await searchProblems('dp')).to.deep.equal([]);

    stubFetch(async () => jsonResponse({}));
    expect(await searchProblems('dp')).to.deep.equal([]);
  });

  it('returns an empty list when the network request throws', async () => {
    stubFetch(async () => {
      throw new TypeError('failed to fetch');
    });
    expect(await searchProblems('dp')).to.deep.equal([]);
  });
});

describe('fetchProblemsByIds', () => {
  const pdocs = [
    { docId: 1001, pid: 'P1001', title: 'A + B', tag: [], difficulty: 1, nSubmit: 10, nAccept: 9 },
    { docId: 1002, pid: 'P1002', title: 'A - B', tag: [], difficulty: 2, nSubmit: 20, nAccept: 8 },
  ];

  it('returns an empty list without any request for empty input', async () => {
    const mock = stubFetch(async () => jsonResponse({ pdocs }));
    expect(await fetchProblemsByIds([])).to.deep.equal([]);
    expect(mock.mock.calls.length).to.equal(0);
  });

  it('issues one search per id and matches by pid or docId, keeping order', async () => {
    const mock = stubFetch(async () => jsonResponse({ pdocs }));

    expect(await fetchProblemsByIds(['P1002', '1001'])).to.deep.equal([
      { docId: 1002, pid: 'P1002', title: 'A - B', tag: [], difficulty: 2, nSubmit: 20, nAccept: 8 },
      { docId: 1001, pid: 'P1001', title: 'A + B', tag: [], difficulty: 1, nSubmit: 10, nAccept: 9 },
    ]);
    expect(mock.mock.calls.length).to.equal(2);
    expect(requestedUrl(mock, 0).searchParams.get('q')).to.equal('P1002');
    expect(requestedUrl(mock, 0).searchParams.get('limit')).to.equal('5');
    expect(requestedUrl(mock, 1).searchParams.get('q')).to.equal('1001');
  });

  it('falls back to a titleless placeholder when an id is not found', async () => {
    stubFetch(async () => jsonResponse({ pdocs }));
    expect(await fetchProblemsByIds(['missing'])).to.deep.equal([{ docId: 0, pid: 'missing', title: '' }]);
  });

  it('degrades numeric ids to placeholders even when the search finds them', async () => {
    // Current behavior: matching uses strict === between the stringified
    // pid/docId and the raw id, so a numeric id never compares equal and
    // always takes the placeholder branch (losing the fetched title).
    stubFetch(async () => jsonResponse({ pdocs }));
    expect(await fetchProblemsByIds([1001])).to.deep.equal([{ docId: 1001, pid: 1001, title: '' }]);
  });
});

describe('problemKey', () => {
  it('prefers the numeric docId', () => {
    expect(problemKey({ docId: 1001, pid: 'P1001', title: 'A + B' })).to.equal('1001');
  });

  it('falls back to the pid when docId is falsy', () => {
    expect(problemKey({ docId: 0, pid: 'P1001', title: 'A + B' })).to.equal('P1001');
  });
});
