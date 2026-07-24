import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { buildExamModeRecordCodePayload, shouldUseLiveClientRecordCodeOnly } from '../src/lib/exam-mode-record';

describe('Exam Mode record code payload', () => {
    it('keeps only the authorized source identity and selected language metadata', () => {
        const tdoc = { docId: 'contest-1', title: 'Contest' };
        const payload = buildExamModeRecordCodePayload({
            tdoc,
            rdoc: {
                _id: 'record-1',
                uid: 867,
                pid: 3060,
                lang: 'cc.cc17',
                code: 'int main() {}',
                files: { code: '867/private-key#main.cpp' },
                status: 1,
                score: 100,
                time: 12,
                memory: 1024,
                progress: 100,
                testCases: [{ status: 1 }],
                subtasks: [{ status: 1 }],
                compilerTexts: ['secret compiler output'],
                judgeTexts: ['secret judge output'],
            },
            pdoc: {
                domainId: 'system',
                docId: 3060,
                pid: 'NK1072',
                title: 'Problem M',
                config: { answers: ['secret'] },
                content: 'statement',
            },
            udoc: { _id: 867, uname: 'student', mail: 'private@example.com', priv: 99 },
            recordStudent: { studentId: '240000001', realName: '真实姓名' },
            langs: {
                'cc.cc17': { display: 'C++ 17' },
                'py.py3': { display: 'Python 3' },
            },
            allRevs: { old: new Date() },
            testHints: { '1-1': { hint: 'secret hint' } },
        });

        expect(payload).to.deep.equal({
            tdoc,
            rdoc: {
                _id: 'record-1',
                uid: 867,
                pid: 3060,
                lang: 'cc.cc17',
                code: 'int main() {}',
            },
            pdoc: {
                docId: 3060,
                title: 'Problem M',
            },
            udoc: { _id: 867, uname: 'student' },
            langs: { 'cc.cc17': { display: 'C++ 17' } },
            examRecordCodeOnly: true,
            examRecordDownloadAvailable: true,
        });
        expect(JSON.stringify(payload)).not.to.include('private-key');
        expect(JSON.stringify(payload)).not.to.include('真实姓名');
        expect(JSON.stringify(payload)).not.to.include('secret');
    });

    it('supports inline-only and uploaded-file submissions without exposing the storage key', () => {
        expect(
            buildExamModeRecordCodePayload({
                rdoc: { _id: 'inline', uid: 1, pid: 1, lang: 'cc.cc17', code: 'return 0;' },
                pdoc: {},
                udoc: {},
                langs: {},
            }).examRecordDownloadAvailable,
        ).to.equal(true);
        const uploaded = buildExamModeRecordCodePayload({
            rdoc: { _id: 'file', uid: 1, pid: 1, lang: '_', files: { code: '1/storage-key#answer.zip' } },
            pdoc: {},
            udoc: {},
            langs: {},
        });
        expect(uploaded.examRecordDownloadAvailable).to.equal(true);
        expect(uploaded.rdoc).not.to.have.property('files');
        expect(buildExamModeRecordCodePayload(uploaded).examRecordDownloadAvailable).to.equal(true);
        expect(
            buildExamModeRecordCodePayload({
                ...uploaded,
                examRecordDownloadAvailable: false,
            }).examRecordDownloadAvailable,
        ).to.equal(false);
    });

    it('restricts only live client-required records for ordinary participants', () => {
        const base = {
            clientRequired: true,
            ongoing: true,
            contestOwner: false,
            canEditContest: false,
            systemAdmin: false,
        };
        expect(shouldUseLiveClientRecordCodeOnly(base)).to.equal(true);
        expect(shouldUseLiveClientRecordCodeOnly({ ...base, clientRequired: false })).to.equal(false);
        expect(shouldUseLiveClientRecordCodeOnly({ ...base, ongoing: false })).to.equal(false);
        expect(shouldUseLiveClientRecordCodeOnly({ ...base, contestOwner: true })).to.equal(false);
        expect(shouldUseLiveClientRecordCodeOnly({ ...base, canEditContest: true })).to.equal(false);
        expect(shouldUseLiveClientRecordCodeOnly({ ...base, systemAdmin: true })).to.equal(false);
    });

    it('fails fast when the canonical record or source shape is invalid', () => {
        expect(() => buildExamModeRecordCodePayload({})).to.throw('Exam Mode record payload is missing rdoc');
        expect(() => buildExamModeRecordCodePayload({ rdoc: { code: { hidden: true } } })).to.throw('Exam Mode record code must be a string');
    });

    it('sanitizes before Exam Mode decoration and gates bound identity to system admins', () => {
        const paperSource = readFileSync(resolve(import.meta.dirname, '../src/handler/paper.ts'), 'utf8');
        const sanitizeAt = paperSource.indexOf('this.response.body = buildExamModeRecordCodePayload({');
        const decorateAt = paperSource.indexOf(
            "await decorateExamMode(this, this.tdoc, 'problems', 'record_detail.html', previewMode, teamContext)",
            sanitizeAt,
        );
        expect(sanitizeAt).to.be.greaterThan(-1);
        expect(decorateAt).to.be.greaterThan(sanitizeAt);
        expect(paperSource).to.include('if (rev) throw new PermissionError(PERM.PERM_VIEW_RECORD)');
        expect(paperSource).to.include('teamContext && !teamContext.canEditCode ? { examRecordDownloadAvailable: false } : {}');

        const recordSource = readFileSync(resolve(import.meta.dirname, '../src/handler/record.ts'), 'utf8');
        expect(recordSource).to.include('this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)');
        expect(recordSource).to.include('findStudentsByUserIds(domainId, [rdoc.uid])');
        expect(recordSource).to.include('recordStudent');
        expect(recordSource).to.include('shouldUseLiveClientRecordCodeOnly({');
        expect(recordSource).to.include('teamMemberCannotDownload');
        expect(recordSource).to.include('buildExamModeRecordCodePayload({');
    });
});
