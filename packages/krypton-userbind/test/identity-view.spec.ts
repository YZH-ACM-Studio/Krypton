import { expect } from 'chai';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildBoundStudentView, stripLegacyProfileIdentity } from '../src/identity-view';
import type { School, StudentRecord } from '../src/types';

function student(overrides: Partial<StudentRecord> = {}): StudentRecord {
    return {
        studentId: '240340179',
        realName: '张三',
        enrollmentYear: 2024,
        ...overrides,
    } as StudentRecord;
}

function school(name: string): School {
    return { name } as School;
}

describe('bound student identity view', () => {
    it('returns unbound when there is no student record', () => {
        expect(buildBoundStudentView(null, school('民航学院'), true)).to.deep.equal({ bound: false });
    });

    it('hides identity fields from anonymous viewers even when bound', () => {
        expect(buildBoundStudentView(student(), school('民航学院'), false)).to.deep.equal({ bound: true });
    });

    it('exposes roster identity and school name for signed-in viewers', () => {
        expect(buildBoundStudentView(student({ enrollmentYear: null }), school('民航学院'), true)).to.deep.equal({
            bound: true,
            realName: '张三',
            studentId: '240340179',
            enrollmentYear: null,
            schoolName: '民航学院',
        });
    });

    it('keeps schoolName null when the roster school is missing', () => {
        expect(buildBoundStudentView(student(), null, true).schoolName).to.equal(null);
    });

    it('strips legacy Hydro profile identity fields', () => {
        const doc = stripLegacyProfileIdentity({
            uname: 'alice',
            studentId: 'self-filled',
            realName: '自填',
            school: '自填学校',
            qq: '123',
        });
        expect(doc).to.deep.equal({ uname: 'alice', qq: '123' });
        expect('studentId' in doc).to.equal(false);
        expect('realName' in doc).to.equal(false);
        expect('school' in doc).to.equal(false);
    });

    it('does not mutate the input document', () => {
        const input = { uname: 'alice', studentId: 'self-filled', realName: '自填', school: '自填学校' };
        const stripped = stripLegacyProfileIdentity(input);
        expect(input).to.deep.equal({ uname: 'alice', studentId: 'self-filled', realName: '自填', school: '自填学校' });
        expect(stripped).to.not.equal(input);
    });
});

describe('identity view wiring source', () => {
    const handler = readFileSync(resolve(__dirname, '../src/handler.ts'), 'utf8');
    const paper = readFileSync(resolve(__dirname, '../../hydrooj/src/handler/paper.ts'), 'utf8');
    const settings = readFileSync(resolve(__dirname, '../../hydrooj/src/model/setting.ts'), 'utf8');
    const userSearch = readFileSync(resolve(__dirname, '../../hydrooj/src/handler/user.ts'), 'utf8');
    const userDetail = handler.slice(handler.indexOf("handler/after/UserDetail#get"), handler.indexOf("handler/after/HomeSettings#get"));
    const homeSettings = handler.slice(handler.indexOf("handler/after/HomeSettings#get"), handler.indexOf('handler/before-prepare'));
    const paperLayout = paper.slice(paper.indexOf('class PaperLayoutHandler'), paper.indexOf('class PaperDraftListHandler'));
    const searchSerialize = userSearch.slice(userSearch.indexOf('return udocs.map((candidate) => {'), userSearch.indexOf('declare module'));

    it('injects the projected view on profile and account settings', () => {
        expect(userDetail).to.include('stripLegacyProfileIdentity(udoc.serialize(h))');
        expect(userDetail).to.include('buildBoundStudentView(student, school, signedIn)');
        expect(userDetail).to.include('signedIn && student ? await userBindModel.getSchool');
        expect(homeSettings).to.include('stripLegacyProfileIdentity(current.serialize(h))');
        expect(homeSettings).to.include('buildBoundStudentView(student, school, true)');
        expect(homeSettings).to.include('student ? await userBindModel.getSchool');
    });

    it('does not show claim-page identity from User.studentId', () => {
        expect(handler).to.not.include('(this.user as any).studentId');
        expect(handler).to.not.include('(this.user as any).realName');
        expect(handler).to.not.include('this.user.studentId');
        expect(handler).to.not.include('this.user.realName');
        expect(handler).to.include('currentCanonicalBinding(domainId, this.user._id)');
    });

    it('exam-mode home and paper layout read userbind instead of User profile fields', () => {
        expect(paper).to.include('const student = await resolveExamModeStudent(this, authoritativeDomainId)');
        expect(paper).to.include('...(student || {})');
        expect(paperLayout).to.include('resolveExamModeStudent(this, domainId)');
        expect(paperLayout).to.include('findStudentsByUserIds(domainId, uids)');
        expect(paperLayout).to.not.include('studentId: u.studentId');
        expect(paperLayout).to.not.include('realName: u.realName');
        expect(paper).to.not.include('(this.user as any).studentId');
        expect(paper).to.not.include('(this.user as any).realName');
    });

    it('user search overlay strips Hydro identity before applying userbind', () => {
        expect(searchSerialize).to.include('delete serialized.studentId');
        expect(searchSerialize).to.include('delete serialized.realName');
        expect(searchSerialize).to.include('delete serialized.school');
        expect(searchSerialize).to.include('student?.studentId');
        expect(searchSerialize).to.include('student?.realName');
    });

    it('disables student self-serve school and studentId account settings', () => {
        expect(settings).to.match(/Setting\('setting_info', 'school'[\s\S]{0,80}FLAG_HIDDEN \| FLAG_DISABLED \| FLAG_PRIVATE/);
        expect(settings).to.match(/Setting\('setting_info', 'studentId'[\s\S]{0,80}FLAG_HIDDEN \| FLAG_DISABLED \| FLAG_PRIVATE/);
    });
});
