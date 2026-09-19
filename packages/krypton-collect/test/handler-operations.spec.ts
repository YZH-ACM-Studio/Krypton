import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const handlerSource = readFileSync(resolve(__dirname, '../src/handler.ts'), 'utf8');

function sliceClass(name: string) {
    const start = handlerSource.indexOf(`class ${name}`);
    expect(start, `missing ${name}`).to.be.at.least(0);
    const next = handlerSource.indexOf('\nclass ', start + 1);
    return handlerSource.slice(start, next === -1 ? undefined : next);
}

describe('collect Hydro operation methods', () => {
    it('creates collections through postCreate instead of a generic post()', () => {
        const edit = sliceClass('AdminCollectEditHandler');
        expect(edit).to.include('async postCreate');
        expect(edit).to.include('async postUpdate');
        expect(edit).to.include('async postPublish');
        expect(edit).to.include('async postArchive');
        expect(edit).to.include('async postDelete');
        expect(edit).to.include("applyEditPost(id, 'create')");
        expect(edit).to.not.match(/async post\(/);
        const applyAt = edit.indexOf('async applyEditPost');
        const archiveAt = edit.indexOf("operation === 'archive'");
        const deleteAt = edit.indexOf("operation === 'delete'");
        const slotsAt = edit.indexOf('const slots = parseSlotsJson');
        expect(applyAt).to.be.at.least(0);
        expect(archiveAt).to.be.greaterThan(applyAt);
        expect(deleteAt).to.be.greaterThan(applyAt);
        expect(slotsAt).to.be.greaterThan(archiveAt);
        expect(slotsAt).to.be.greaterThan(deleteAt);
    });

    it('maps list and stats form operations to Hydro post* methods', () => {
        const list = sliceClass('AdminCollectListHandler');
        const stats = sliceClass('AdminCollectStatsHandler');
        expect(list).to.include('async postPublish');
        expect(list).to.include('async postClose');
        expect(list).to.include('async postReopen');
        expect(list).to.include('async postArchive');
        expect(list).to.include('async postDelete');
        expect(list).to.not.match(/async post\(/);
        expect(stats).to.include('async postNudge');
        expect(stats).to.include('async postArchive');
        expect(stats).to.include('async postDelete');
        expect(stats).to.not.match(/async post\(/);
    });

    it('maps student file operations to Hydro post* methods', () => {
        const detail = sliceClass('CollectDetailHandler');
        expect(detail).to.include('async postUploadFile');
        expect(detail).to.include('async postReplaceFile');
        expect(detail).to.include('async postDeleteFile');
        expect(detail).to.include('async postConfirm');
        expect(detail).to.not.match(/async post\(/);
        const applyAt = detail.indexOf('async applyStudentPost');
        const gateAt = detail.indexOf('assertCollectExamCompleteForStudent');
        const uploadAt = detail.indexOf("operation === 'upload_file'");
        expect(applyAt).to.be.at.least(0);
        expect(gateAt, 'student writes must re-check the optional exam-complete gate').to.be.greaterThan(applyAt);
        expect(uploadAt).to.be.greaterThan(gateAt);
    });

    it('derives assignedName through model assignedNameForFile and fileIndexInSlot', () => {
        expect(handlerSource).not.to.match(/function currentFileIndex\(/);
        expect(handlerSource).not.to.match(/function assignedNameFor\(/);
        expect(handlerSource).to.include('assignedNameForFile');
        expect(handlerSource).to.include('nextAssignedNameForSlot');
        expect(handlerSource).to.include('fileIndexInSlot');
        const detail = sliceClass('CollectDetailHandler');
        const stats = sliceClass('AdminCollectStatsHandler');
        expect(detail).to.include('assignedNameForFile');
        expect(detail).to.include('nextAssignedNameForSlot');
        expect(detail).to.include('fileIndexInSlot');
        expect(detail).not.to.include('fileNameTemplate: requestFileNameTemplate(request.fileNameTemplate)');
        expect(detail).not.to.include('identity: { uid: this.user._id');
        expect(stats).to.include('assignedNameForFile');
        expect(stats).to.include('fileIndexInSlot');
    });

    it('hides collect existence from non-viewers who are not the audience', () => {
        expect(handlerSource).to.include('async function assertCanViewCollectOrHide(');
        expect(handlerSource).to.include("request.status === 'draft' || request.status === 'archived'");
        expect(handlerSource).to.include('isAudienceMember(domainId, user._id, request)');
        const download = sliceClass('CollectFileDownloadHandler');
        expect(download).to.include('CollectNotFoundError');
        const edit = sliceClass('AdminCollectEditHandler');
        const stats = sliceClass('AdminCollectStatsHandler');
        const pack = sliceClass('AdminCollectPackHandler');
        const adminFile = sliceClass('AdminCollectFileDownloadHandler');
        expect(edit).to.include("assertCanViewCollectOrHide(this.user, request, domainId, '无权查看该收集')");
        expect(edit).to.include("assertCanViewCollectOrHide(this.user, current, domainId, '无权查看该收集')");
        const list = sliceClass('AdminCollectListHandler');
        expect(list).to.include("assertCanViewCollectOrHide(this.user, current, domainId, '无权查看该收集')");
        expect(stats).to.include("assertCanViewCollectOrHide(this.user, request, domainIdOf(this), '无权查看该收集')");
        expect(stats).to.include('async postNudge');
        expect(stats).to.include("assertCanViewCollectOrHide(this.user, request, domainIdOf(this), '无权查看该收集')");
        expect(pack).to.include("assertCanViewCollectOrHide(this.user, request, domainIdOf(this), '无权打包')");
        expect(adminFile).to.include("assertCanViewCollectOrHide(this.user, request, domainIdOf(this), '无权下载')");
    });
});
