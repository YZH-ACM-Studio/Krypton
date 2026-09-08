import { expect } from 'chai';
import { describe, it } from 'node:test';

const Module = require('module');
const framework = require('../../../framework/framework');
const packPath = require.resolve('../src/pack-format.ts');
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

type PackFormat = typeof import('../src/pack-format');
let packFormat: PackFormat;
try {
    delete require.cache[packPath];
    delete require.cache[nameFormatPath];
    delete require.cache[errorsPath];
    packFormat = require(packPath) as PackFormat;
} finally {
    Module._load = originalLoad;
}

const {
    buildMissingCsv,
    buildSubmittedCsv,
    csvCell,
    sanitizeZipPart,
    zipEntryName,
    zipStudentFolder,
} = packFormat;

function packName(input: {
    studentId?: string;
    realName?: string;
    slotTitle: string;
    originalName: string;
    uid: number;
}): string {
    return zipEntryName(zipStudentFolder(input), input.slotTitle, input.originalName);
}

describe('collect pack naming', () => {
    it('builds zip entries as studentId-realName/slotTitle/originalName', () => {
        expect(
            packName({
                studentId: '24000001',
                realName: '张三',
                slotTitle: '实验报告',
                originalName: 'lab.pdf',
                uid: 9,
            }),
        ).to.equal('24000001-张三/实验报告/lab.pdf');
    });

    it('uses unbound-UID{uid} when userbind has no studentId', () => {
        expect(zipStudentFolder({ uid: 42, realName: '佚名' })).to.equal('unbound-UID42');
        expect(
            packName({
                uid: 42,
                realName: '佚名',
                slotTitle: '报告',
                originalName: 'a.pdf',
            }),
        ).to.equal('unbound-UID42/报告/a.pdf');
        expect(zipStudentFolder({ uid: 7, studentId: '', realName: 'x' })).to.equal('unbound-UID7');
    });

    it('sanitizes path separators and reserved filename characters', () => {
        expect(sanitizeZipPart('a\\b/c:d*e?f"g<h>i|j')).to.equal('a_b_c_d_e_f_g_h_i_j');
        expect(sanitizeZipPart('..')).to.equal('_');
        expect(sanitizeZipPart('.')).to.equal('_');
        expect(sanitizeZipPart('')).to.equal('_');
        expect(
            packName({
                studentId: '12/34:名',
                realName: '李*四',
                slotTitle: '槽?1',
                originalName: 'a<>.pdf',
                uid: 3,
            }),
        ).to.equal('12_34_名-李_四/槽_1/a__.pdf');
    });
});

describe('collect csv formula neutralization', () => {
    it('prefixes Excel formula starters even after leading whitespace', () => {
        expect(csvCell('=HYPERLINK("https://example.invalid")')).to.equal(`"'=HYPERLINK(""https://example.invalid"")"`);
        expect(csvCell('+24000002')).to.equal("'+24000002");
        expect(csvCell(' @SUM(1,1)')).to.equal(`"' @SUM(1,1)"`);
        expect(csvCell('-1+1')).to.equal("'-1+1");
        expect(csvCell('\tbad')).to.equal(`"'\tbad"`);
        expect(csvCell('张三')).to.equal('张三');
        expect(csvCell(42)).to.equal('42');
        expect(csvCell('\u200b=HYPERLINK("https://example.invalid")')).to.equal(`"'\u200b=HYPERLINK(""https://example.invalid"")"`);
    });

    it('quotes commas, quotes, and line breaks after neutralization', () => {
        expect(csvCell('a,b')).to.equal('"a,b"');
        expect(csvCell('say "hi"')).to.equal('"say ""hi"""');
        expect(csvCell('第一行\n第二行')).to.equal('"第一行\n第二行"');
    });
});

describe('collect pack csv tables', () => {
    it('writes missing csv with slot and expected assigned name', () => {
        expect(buildMissingCsv([{
            studentId: '24000001',
            realName: '张三',
            uid: 9,
            slotTitle: '实验报告',
            assignedName: 'lab.pdf',
        }])).to.equal('\uFEFF学号,姓名,UID,槽位,预期文件名\r\n24000001,张三,9,实验报告,lab.pdf\r\n');
    });

    it('writes submitted csv with assigned name, original name, hash, and size', () => {
        expect(buildSubmittedCsv([{
            studentId: '24000001',
            realName: '张三',
            uid: 9,
            slotTitle: '实验报告',
            assignedName: '24000001_张三_实验报告.pdf',
            originalName: 'lab.pdf',
            sha256: 'abc',
            size: 12,
        }])).to.equal('\uFEFF学号,姓名,UID,槽位,文件名,原文件名,sha256,size\r\n24000001,张三,9,实验报告,24000001_张三_实验报告.pdf,lab.pdf,abc,12\r\n');
    });

    it('neutralizes formula starters in csv table cells', () => {
        expect(buildMissingCsv([{
            studentId: '=1+1',
            realName: '张三',
            uid: 9,
            slotTitle: '实验报告',
            assignedName: '+cmd',
        }])).to.equal('\uFEFF学号,姓名,UID,槽位,预期文件名\r\n\'=1+1,张三,9,实验报告,\'+cmd\r\n');
    });
});
