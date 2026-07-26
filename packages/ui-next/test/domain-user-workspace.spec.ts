import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { filterDomainUsers, flattenDomainUsers, getSelectableDomainUserIds, paginateDomainUsers } from '../src/lib/domain-user-workspace';

describe('p2.35 domain user workspace', () => {
  const rows = flattenDomainUsers(
    {
      teacher: [
        { _id: 20, uname: 'mentor', displayName: '张老师', join: true },
        { _id: 3, uname: 'alice', displayName: '李老师', join: true },
      ],
      student: [{ _id: 1001, uname: 'student-a', displayName: '王同学', role: 'student', join: true }],
    },
    ['teacher', 'student'],
  );

  it('flattens role groups in stable role, name, and numeric UID order', () => {
    expect(rows).to.deep.equal([
      { uid: '3', uname: 'alice', displayName: '李老师', role: 'teacher', joined: true },
      { uid: '20', uname: 'mentor', displayName: '张老师', role: 'teacher', joined: true },
      { uid: '1001', uname: 'student-a', displayName: '王同学', role: 'student', joined: true },
    ]);
  });

  it('searches UID, username, and visible display name with an optional role filter', () => {
    expect(filterDomainUsers(rows, '1001', '').map((row) => row.uid)).to.deep.equal(['1001']);
    expect(filterDomainUsers(rows, 'MENTOR', '').map((row) => row.uid)).to.deep.equal(['20']);
    expect(filterDomainUsers(rows, '王同学', '').map((row) => row.uid)).to.deep.equal(['1001']);
    expect(filterDomainUsers(rows, '', 'teacher').map((row) => row.uid)).to.deep.equal(['3', '20']);
    expect(filterDomainUsers(rows, '王', 'teacher')).to.deep.equal([]);
  });

  it('fails fast on malformed or duplicate grouped data', () => {
    expect(() => flattenDomainUsers({ teacher: undefined })).to.throw('must be an array');
    expect(() => flattenDomainUsers({ teacher: [{ _id: 2 }], student: [{ _id: 2 }] })).to.throw('appears in more than one role');
    expect(() => flattenDomainUsers({ teacher: [{ _id: '' }] })).to.throw('missing a UID');
  });

  it('keeps the client roster bounded to fifty rows and clamps pages', () => {
    const fifty = Array.from({ length: 50 }, (_, index) => index + 1);
    const fiftyOne = Array.from({ length: 51 }, (_, index) => index + 1);
    const oneHundredTwentyFive = Array.from({ length: 125 }, (_, index) => index + 1);
    expect(paginateDomainUsers([], 1)).to.deep.include({ page: 1, totalPages: 1, start: 0, end: 0 });
    expect(paginateDomainUsers(fifty, 1)).to.deep.include({ page: 1, totalPages: 1, start: 1, end: 50 });
    expect(paginateDomainUsers(fiftyOne, 2)).to.deep.include({ page: 2, totalPages: 2, start: 51, end: 51 });
    expect(paginateDomainUsers(fiftyOne, 99)).to.deep.include({ page: 2, start: 51, end: 51 });
    expect(paginateDomainUsers(oneHundredTwentyFive, 3)).to.deep.include({
      page: 3,
      totalPages: 3,
      start: 101,
      end: 125,
    });
    expect(() => paginateDomainUsers(fifty, 1, 0)).to.throw('pageSize must be a positive integer');
  });

  it('never includes the domain owner in current-page batch selection', () => {
    expect(getSelectableDomainUserIds(rows, '3')).to.deep.equal(['20', '1001']);
    expect(getSelectableDomainUserIds(rows, '')).to.deep.equal(['3', '20', '1001']);
    const secondPage = paginateDomainUsers(rows, 2, 2);
    expect(getSelectableDomainUserIds(secondPage.items, '1001')).to.deep.equal([]);
  });

  it('retains native mutation fields and replaces native confirms with dialogs', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/pages/domain-manage.tsx'), 'utf8');
    const start = source.indexOf('function AddDomainUsersDialog');
    const end = source.indexOf('/*  Domain Groups', start);
    expect(start).to.be.greaterThan(-1);
    expect(end).to.be.greaterThan(start);
    const domainUserSource = source.slice(start, end);
    expect(domainUserSource).to.include('name="operation" value="set_users"');
    expect(domainUserSource).to.include('name="operation" value="kick"');
    expect(domainUserSource).to.include('name="uids"');
    expect(domainUserSource).to.include('name="role"');
    expect(domainUserSource).to.include('name="join"');
    expect(domainUserSource).to.include('<RoleQuickSelect');
    expect(domainUserSource).to.include('添加或更新域用户');
    expect(domainUserSource).to.include('确认移除域用户');
    expect(domainUserSource).to.include('清空选择');
    expect(domainUserSource).to.include('disabled={user.uid === ownerUid}');
    expect(domainUserSource).to.include('role="dialog"');
    expect(domainUserSource).to.include('onKeyDown={trapDialogFocus}');
    expect(domainUserSource).to.include('returnFocusRef');
    expect(domainUserSource).to.include('title={user.displayName || user.uname');
    expect(domainUserSource).to.not.include('window.confirm');
  });
});
