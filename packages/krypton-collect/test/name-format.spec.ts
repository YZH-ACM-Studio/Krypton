import { expect } from 'chai';
import { describe, it } from 'node:test';
import type { CollectNameContext } from '../src/name-format';

const Module = require('module');
const framework = require('../../../framework/framework');

const nameFormatPath = require.resolve('../src/name-format.ts');
const errorsPath = require.resolve('../src/errors.ts');
const originalLoad = Module._load;

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (parent?.filename === errorsPath && request === 'hydrooj') {
        return {
            CreateError: framework.CreateError,
            ForbiddenError: framework.ForbiddenError,
            NotFoundError: framework.NotFoundError,
            UserFacingError: framework.UserFacingError,
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let nameFormat: typeof import('../src/name-format');
try {
    delete require.cache[nameFormatPath];
    delete require.cache[errorsPath];
    nameFormat = require(nameFormatPath) as typeof import('../src/name-format');
} finally {
    Module._load = originalLoad;
}

const {
    COLLECT_DEFAULT_FILE_NAME_TEMPLATE,
    COLLECT_DEFAULT_PACK_LAYOUT,
    COLLECT_MISSING_STEM,
    COLLECT_NAME_TOKENS,
    applyRealExt,
    dedupePackNames,
    missingOriginalName,
    originalStem,
    parseFileNameTemplate,
    parsePackLayout,
    renderAssignedFileName,
    renderPackEntryName,
    requestFileNameTemplate,
    requestPackLayout,
    slotPreviewExt,
} = nameFormat;

function ctx(partial: Partial<CollectNameContext> = {}): CollectNameContext {
    return {
        uid: 9,
        studentId: '24000001',
        realName: '张三',
        slotTitle: '实验报告',
        index: 1,
        ext: 'pdf',
        originalName: 'lab.pdf',
        ...partial,
    };
}

function rejectedText(error: unknown): string {
    if (error && typeof error === 'object' && 'params' in error) {
        const params = (error as { params: unknown }).params;
        if (Array.isArray(params) && params.length) return String(params[0]);
    }
    return error instanceof Error ? error.message : String(error);
}

function expectRejected(run: () => unknown, needle: string) {
    try {
        run();
    } catch (error) {
        expect((error as { name?: string }).name).to.equal('CollectFileRejectedError');
        expect(rejectedText(error)).to.include(needle);
        return;
    }
    expect.fail(`expected CollectFileRejectedError including ${needle}`);
}

describe('collect name-format tokens', () => {
    it('lists the seven tokens and renders each of them', () => {
        expect([...COLLECT_NAME_TOKENS]).to.deep.equal([
            'studentId',
            'realName',
            'slotTitle',
            'index',
            'ext',
            'originalStem',
            'originalName',
        ]);
        expect(renderAssignedFileName('{studentId}', ctx())).to.equal('24000001.pdf');
        expect(renderAssignedFileName('{realName}', ctx())).to.equal('张三.pdf');
        expect(renderAssignedFileName('{slotTitle}', ctx())).to.equal('实验报告.pdf');
        expect(renderAssignedFileName('{index}', ctx({ index: 3 }))).to.equal('3.pdf');
        expect(renderAssignedFileName('{ext}', ctx())).to.equal('pdf.pdf');
        expect(renderAssignedFileName('{originalStem}', ctx())).to.equal('lab.pdf');
        expect(renderAssignedFileName('{originalName}', ctx())).to.equal('lab.pdf');
        expect(renderAssignedFileName(
            '{studentId}_{realName}_{slotTitle}_{index}_{originalStem}',
            ctx(),
        )).to.equal('24000001_张三_实验报告_1_lab.pdf');
    });

    it('forces the real extension and falls back for empty identity fields', () => {
        expect(applyRealExt('photo.jpeg', 'jpg')).to.equal('photo.jpg');
        expect(applyRealExt('report.PDF', 'pdf')).to.equal('report.pdf');
        expect(renderAssignedFileName('{studentId}', ctx({ studentId: '', uid: 42 }))).to.equal('unbound-UID42.pdf');
        expect(renderAssignedFileName('{realName}', ctx({ realName: '  ' }))).to.equal('_.pdf');
        expect(originalStem('lab.pdf')).to.equal('lab');
        expect(slotPreviewExt({ allowedExt: ['zip', 'pdf'] })).to.equal('zip');
    });
});

describe('collect name-format defaults', () => {
    it('keeps nested 学号-姓名/槽/原名 when the template is the default', () => {
        expect(COLLECT_DEFAULT_FILE_NAME_TEMPLATE).to.equal('{originalName}');
        expect(COLLECT_DEFAULT_PACK_LAYOUT).to.equal('nested');
        expect(parseFileNameTemplate(null)).to.equal('{originalName}');
        expect(parseFileNameTemplate('')).to.equal('{originalName}');
        expect(parsePackLayout(null)).to.equal('nested');
        expect(parsePackLayout('')).to.equal('nested');
        expect(requestFileNameTemplate(undefined)).to.equal('{originalName}');
        expect(requestPackLayout(undefined)).to.equal('nested');
        const assigned = renderAssignedFileName(COLLECT_DEFAULT_FILE_NAME_TEMPLATE, ctx());
        expect(assigned).to.equal('lab.pdf');
        expect(renderPackEntryName(COLLECT_DEFAULT_PACK_LAYOUT, '24000001-张三', '实验报告', assigned))
            .to.equal('24000001-张三/实验报告/lab.pdf');
    });
});

describe('collect name-format flat', () => {
    it('renders only the assigned file name at the zip root', () => {
        const assigned = renderAssignedFileName('{studentId}_{realName}_{slotTitle}', ctx());
        expect(assigned).to.equal('24000001_张三_实验报告.pdf');
        expect(parsePackLayout('flat')).to.equal('flat');
        expect(renderPackEntryName('flat', '24000001-张三', '实验报告', assigned)).to.equal('24000001_张三_实验报告.pdf');
        expect(renderPackEntryName('flat', '24000001-张三', '实验报告', assigned)).to.not.include('/');
    });
});

describe('collect name-format missing 未交', () => {
    it('fills original tokens with 未交 and the slot preview extension', () => {
        expect(COLLECT_MISSING_STEM).to.equal('未交');
        expect(missingOriginalName('pdf')).to.equal('未交.pdf');
        expect(originalStem('')).to.equal('未交');
        expect(renderAssignedFileName('{originalName}', ctx({ originalName: '' }))).to.equal('未交.pdf');
        expect(renderAssignedFileName('{originalStem}', ctx({ originalName: '   ' }))).to.equal('未交.pdf');
        expect(renderAssignedFileName('{originalName}', ctx({
            originalName: '',
            ext: 'zip',
            slotTitle: '附件',
        }))).to.equal('未交.zip');
        expect(renderAssignedFileName('{studentId}_{realName}_{slotTitle}', ctx({ originalName: '' })))
            .to.equal('24000001_张三_实验报告.pdf');
        expect(renderAssignedFileName('{index}', ctx({ index: 0, originalName: '' }))).to.equal('1.pdf');
        expect(slotPreviewExt({ allowedExt: [] })).to.equal('pdf');
    });
});

describe('collect name-format collision suffix', () => {
    it('keeps the first name and appends -{fileId} before the extension', () => {
        const deduped = dedupePackNames([
            { name: '24000001_张三_实验报告.pdf', fileId: 'id1', extra: 1 },
            { name: '24000001_张三_实验报告.pdf', fileId: 'id2', extra: 2 },
            { name: 'other.pdf', fileId: 'id3', extra: 3 },
            { name: '24000001_张三_实验报告.PDF', fileId: 'id4', extra: 4 },
        ]);
        expect(deduped.map((row) => row.name)).to.deep.equal([
            '24000001_张三_实验报告.pdf',
            '24000001_张三_实验报告-id2.pdf',
            'other.pdf',
            '24000001_张三_实验报告-id4.pdf',
        ]);
        expect(deduped[1].fileId).to.equal('id2');
        expect(deduped[1].extra).to.equal(2);
        expect(dedupePackNames([
            { name: 'photo.jpeg', fileId: 'img1' },
            { name: 'photo.jpeg', fileId: 'img2' },
        ]).map((row) => row.name)).to.deep.equal(['photo.jpeg', 'photo-img2.jpg']);
    });
});

describe('collect name-format illegal template', () => {
    it('rejects unknown tokens, path characters, reserved names, and bad layouts', () => {
        expect(parseFileNameTemplate('{studentId}_{realName}_{slotTitle}')).to.equal('{studentId}_{realName}_{slotTitle}');
        expectRejected(() => parseFileNameTemplate('{unknown}'), '未知文件名变量');
        expectRejected(() => parseFileNameTemplate('{studentId}/{realName}'), '非法字符');
        expectRejected(() => parseFileNameTemplate('{studentId}\\{realName}'), '非法字符');
        expectRejected(() => parseFileNameTemplate('a:b*c?d"e<f>g|h'), '非法字符');
        expectRejected(() => parseFileNameTemplate('{student'), '不合法');
        expectRejected(() => parseFileNameTemplate('{1}'), '不合法');
        expectRejected(() => parseFileNameTemplate('   '), '不能为空');
        expectRejected(() => parseFileNameTemplate('x'.repeat(201)), '过长');
        expectRejected(() => parseFileNameTemplate(12), '不合法');
        expectRejected(() => parsePackLayout('tree'), '打包目录格式不合法');
        expectRejected(() => parsePackLayout('nested-flat'), '打包目录格式不合法');
    });
});
