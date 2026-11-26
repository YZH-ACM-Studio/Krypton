import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectSigningReturnFromPath, parseCollectSigningReturn, withCollectSigningReturn } from '../src/lib/collect-signing-return';

const first = '/collect/0123456789abcdef01234567/sign';
const second = '/collect/abcdef0123456789abcdef01/sign';

describe('collect signing continuation', () => {
    it('keeps destinations in the current domain and isolated between requests', () => {
        assert.equal(parseCollectSigningReturn(first, 'system')?.path, first);
        assert.equal(parseCollectSigningReturn(second, 'system')?.path, second);
        assert.equal(parseCollectSigningReturn(first, 'system')?.path, first);
        assert.equal(parseCollectSigningReturn(`/d/lab${first}`, 'lab')?.path, `/d/lab${first}`);
        assert.equal(parseCollectSigningReturn(first, 'lab')?.path, first);
        assert.equal(parseCollectSigningReturn(undefined, 'system'), null);
        assert.equal(withCollectSigningReturn('/login', null), '/login');
        const url = new URL(withCollectSigningReturn('/login?lang=zh', first), 'https://oj.test');
        assert.equal(url.searchParams.get('collectSign'), first);
        assert.equal(url.searchParams.get('lang'), 'zh');
    });

    it('rejects external, malformed, encoded, unrelated and cross-domain destinations', () => {
        for (const value of [
            '', 'https://evil.test', '//evil.test', `https://oj.test${first}`, `/d/other${first}`,
            '/problem/1', `${first}?next=evil`, `${first}#part`, `${first}\n`, `${first}/`,
            first.replace('/collect', '/%63ollect'), first.replace('/collect', '/\\evil.test/collect'),
            first.replace('/collect', '//collect'), first.replace('0123456789abcdef01234567', '../login'),
            first.replace('0123456789abcdef01234567', 'invalid'), [first], { path: first },
        ]) assert.throws(() => parseCollectSigningReturn(value, 'system'), { name: 'ValidationError' });
    });

    it('preserves only actual signing entries when force-bind intercepts a request', () => {
        assert.equal(collectSigningReturnFromPath(first, 'system')?.path, first);
        assert.equal(collectSigningReturnFromPath(`/d/lab${first}`, 'lab')?.path, `/d/lab${first}`);
        for (const path of ['/problem/1', '/api/anything', '/login', '/userbind', '/collect']) {
            assert.equal(collectSigningReturnFromPath(path, 'system'), null);
        }
        assert.throws(() => collectSigningReturnFromPath('/collect/invalid/sign', 'system'));
        assert.throws(() => collectSigningReturnFromPath(`/d/other${first}`, 'system'));
    });
});
