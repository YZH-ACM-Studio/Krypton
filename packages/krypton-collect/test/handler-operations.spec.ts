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
        expect(edit).to.include("applyEditPost(id, 'create')");
        expect(edit).to.not.match(/async post\(/);
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
        expect(stats).to.not.match(/async post\(/);
    });

    it('maps student file operations to Hydro post* methods', () => {
        const detail = sliceClass('CollectDetailHandler');
        expect(detail).to.include('async postUploadFile');
        expect(detail).to.include('async postReplaceFile');
        expect(detail).to.include('async postDeleteFile');
        expect(detail).to.include('async postConfirm');
        expect(detail).to.not.match(/async post\(/);
    });

    it('derives assignedName through model assignedNameForFile and fileIndexInSlot', () => {
        expect(handlerSource).not.to.match(/function currentFileIndex\(/);
        expect(handlerSource).not.to.match(/function assignedNameFor\(/);
        expect(handlerSource).to.include('assignedNameForFile');
        expect(handlerSource).to.include('fileIndexInSlot');
        const detail = sliceClass('CollectDetailHandler');
        const stats = sliceClass('AdminCollectStatsHandler');
        expect(detail).to.include('assignedNameForFile');
        expect(detail).to.include('fileIndexInSlot');
        expect(stats).to.include('assignedNameForFile');
        expect(stats).to.include('fileIndexInSlot');
    });
});
