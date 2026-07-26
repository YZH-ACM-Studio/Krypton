// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildSudoReplayFields, resolveSudoChallengeUrl, resolveSudoReplayTarget } from '../src/lib/sudo-replay.ts';

describe('buildSudoReplayFields', () => {
  it('rejects argument bags that are not plain objects', () => {
    expect(() => buildSudoReplayFields(null)).to.throw(TypeError, '身份验证重放参数无效');
    expect(() => buildSudoReplayFields(undefined)).to.throw('身份验证重放参数无效');
    expect(() => buildSudoReplayFields('uid=1')).to.throw('身份验证重放参数无效');
    expect(() => buildSudoReplayFields(42)).to.throw('身份验证重放参数无效');
    expect(() => buildSudoReplayFields(['uid'])).to.throw('身份验证重放参数无效');
  });

  it('serializes scalar fields in declaration order', () => {
    expect(buildSudoReplayFields({
      uid: 42,
      role: 'admin',
      active: true,
      big: 9n,
    })).to.deep.equal([
      { name: 'uid', value: '42' },
      { name: 'role', value: 'admin' },
      { name: 'active', value: 'true' },
      { name: 'big', value: '9' },
    ]);
  });

  it('keeps falsy scalars that are still submittable', () => {
    expect(buildSudoReplayFields({ zero: 0, empty: '', no: false })).to.deep.equal([
      { name: 'zero', value: '0' },
      { name: 'empty', value: '' },
      { name: 'no', value: 'false' },
    ]);
  });

  it('drops __start plus null and undefined values', () => {
    expect(buildSudoReplayFields({
      __start: '1699999999',
      keep: 'x',
      gone: null,
      missing: undefined,
    })).to.deep.equal([{ name: 'keep', value: 'x' }]);
  });

  it('expands arrays into repeated fields and elides empty arrays', () => {
    expect(buildSudoReplayFields({ tags: ['a', 'b'], nothing: [] })).to.deep.equal([
      { name: 'tags', value: 'a' },
      { name: 'tags', value: 'b' },
    ]);
  });

  it('expands zero-based index-keyed objects in numeric order', () => {
    expect(buildSudoReplayFields({ tags: { 1: 'b', 0: 'a', 2: 'c' } })).to.deep.equal([
      { name: 'tags', value: 'a' },
      { name: 'tags', value: 'b' },
      { name: 'tags', value: 'c' },
    ]);
  });

  it('rejects object values that are not dense zero-based index maps', () => {
    expect(() => buildSudoReplayFields({ tags: {} })).to.throw('不是可提交的重复字段');
    expect(() => buildSudoReplayFields({ tags: { a: 'x' } })).to.throw('不是可提交的重复字段');
    expect(() => buildSudoReplayFields({ tags: { '01': 'x' } })).to.throw('不是可提交的重复字段');
    expect(() => buildSudoReplayFields({ tags: { 0: 'a', 2: 'c' } })).to.throw('顺序无效');
    expect(() => buildSudoReplayFields({ tags: { 1: 'b', 2: 'c' } })).to.throw('顺序无效');
  });

  it('rejects leaf values that are not submittable scalars', () => {
    expect(() => buildSudoReplayFields({ n: Number.NaN })).to.throw('不是可提交的标量');
    expect(() => buildSudoReplayFields({ n: Infinity })).to.throw('不是可提交的标量');
    expect(() => buildSudoReplayFields({ nested: [['deep']] })).to.throw('不是可提交的标量');
    expect(() => buildSudoReplayFields({ list: [{ 0: 'x' }] })).to.throw('不是可提交的标量');
  });
});

describe('resolveSudoReplayTarget', () => {
  it('accepts post redirects to same-site absolute paths', () => {
    expect(resolveSudoReplayTarget('post', '/d/system/domain/permission')).to.equal('/d/system/domain/permission');
    expect(resolveSudoReplayTarget('POST', '/user/setting')).to.equal('/user/setting');
  });

  it('rejects every non-post method', () => {
    expect(() => resolveSudoReplayTarget('get', '/x')).to.throw('身份验证仅支持重放 POST 操作');
    expect(() => resolveSudoReplayTarget('DELETE', '/x')).to.throw('身份验证仅支持重放 POST 操作');
    expect(() => resolveSudoReplayTarget(undefined, '/x')).to.throw('身份验证仅支持重放 POST 操作');
  });

  it('rejects redirect targets that could leave the site', () => {
    expect(() => resolveSudoReplayTarget('post', 'https://evil.example/x')).to.throw('身份验证重放地址无效');
    expect(() => resolveSudoReplayTarget('post', '//evil.example/x')).to.throw('身份验证重放地址无效');
    expect(() => resolveSudoReplayTarget('post', 'relative/path')).to.throw('身份验证重放地址无效');
    expect(() => resolveSudoReplayTarget('post', undefined)).to.throw('身份验证重放地址无效');
  });
});

describe('resolveSudoChallengeUrl', () => {
  const HREF = 'https://oj.example/d/system/domain/permission?page=2';

  it('returns null for payloads that are not `{ url: string }`', () => {
    expect(resolveSudoChallengeUrl(null, HREF)).to.equal(null);
    expect(resolveSudoChallengeUrl(undefined, HREF)).to.equal(null);
    expect(resolveSudoChallengeUrl('/user/sudo', HREF)).to.equal(null);
    expect(resolveSudoChallengeUrl(['/user/sudo'], HREF)).to.equal(null);
    expect(resolveSudoChallengeUrl({}, HREF)).to.equal(null);
    expect(resolveSudoChallengeUrl({ url: 42 }, HREF)).to.equal(null);
  });

  it('resolves the canonical same-origin sudo path', () => {
    expect(resolveSudoChallengeUrl({ url: '/user/sudo' }, HREF)).to.equal('https://oj.example/user/sudo');
    expect(resolveSudoChallengeUrl({ url: 'https://oj.example/user/sudo' }, HREF)).to.equal('https://oj.example/user/sudo');
  });

  it('rejects challenge urls on a foreign origin', () => {
    expect(() => resolveSudoChallengeUrl({ url: 'https://evil.example/user/sudo' }, HREF)).to.throw('权限操作返回了无效的身份验证地址');
    expect(() => resolveSudoChallengeUrl({ url: '//evil.example/user/sudo' }, HREF)).to.throw('权限操作返回了无效的身份验证地址');
  });

  it('rejects challenge urls that are not exactly /user/sudo', () => {
    expect(() => resolveSudoChallengeUrl({ url: '/user/login' }, HREF)).to.throw('权限操作返回了无效的身份验证地址');
    // relative paths resolve against the current page and drift off the sudo path
    expect(() => resolveSudoChallengeUrl({ url: 'user/sudo' }, HREF)).to.throw('权限操作返回了无效的身份验证地址');
  });

  it('rejects sudo urls decorated with a query string or fragment', () => {
    expect(() => resolveSudoChallengeUrl({ url: '/user/sudo?next=/x' }, HREF)).to.throw('权限操作返回了无效的身份验证地址');
    expect(() => resolveSudoChallengeUrl({ url: '/user/sudo#step' }, HREF)).to.throw('权限操作返回了无效的身份验证地址');
  });
});
