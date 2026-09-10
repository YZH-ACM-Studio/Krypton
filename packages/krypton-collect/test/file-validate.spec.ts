import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    COLLECT_HARD_MAX_FILE_BYTES,
    type CollectAllowedExt,
    type CollectSlot,
} from '../src/types';

const Module = require('module');
const framework = require('../../../framework/framework');
const fileValidatePath = require.resolve('../src/file-validate.ts');
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

interface FileValidate {
    detectExtMagic(header: Uint8Array, claimedExt: string): boolean;
    assertUploadAllowed(args: {
        filename: string;
        size: number;
        slot: Pick<CollectSlot, 'allowedExt'>;
        header: Uint8Array;
    }): { ext: CollectAllowedExt; originalName: string };
}

let fileValidate: FileValidate;
try {
    delete require.cache[fileValidatePath];
    delete require.cache[errorsPath];
    fileValidate = require(fileValidatePath) as FileValidate;
} finally {
    Module._load = originalLoad;
}

const { detectExtMagic, assertUploadAllowed } = fileValidate;

const slot: Pick<CollectSlot, 'allowedExt'> = {
    allowedExt: ['pdf', 'docx', 'zip', 'png', 'jpg'],
};

const PDF = Uint8Array.of(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x34);
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPG = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0);
const ZIP_LOCAL = Uint8Array.of(0x50, 0x4b, 0x03, 0x04);
const ZIP_EOCD = Uint8Array.of(0x50, 0x4b, 0x05, 0x06);
const ZIP_SPANNED = Uint8Array.of(0x50, 0x4b, 0x07, 0x08);

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
    expect.fail('expected CollectFileRejectedError');
}

function upload(overrides: {
    filename?: string;
    size?: number;
    slot?: Pick<CollectSlot, 'allowedExt'>;
    header?: Uint8Array;
} = {}) {
    return assertUploadAllowed({
        filename: 'report.pdf',
        size: 32,
        slot,
        header: PDF,
        ...overrides,
    });
}

describe('krypton-collect file-validate', () => {
    it('maps jpeg to jpg when magic matches', () => {
        const result = upload({ filename: 'photo.jpeg', header: JPG });
        expect(result.ext).to.equal('jpg');
        expect(result.originalName).to.equal('photo.jpeg');
    });

    it('rejects html even when the header looks like pdf', () => {
        expectRejected(() => upload({ filename: 'page.html', header: PDF }), '类型');
    });

    it('rejects empty files', () => {
        expectRejected(() => upload({ size: 0 }), '空文件');
    });

    it('accepts zip/docx PK magic variants and rejects a mismatch', () => {
        expect(detectExtMagic(ZIP_LOCAL, 'zip')).to.equal(true);
        expect(detectExtMagic(ZIP_EOCD, 'zip')).to.equal(true);
        expect(detectExtMagic(ZIP_SPANNED, 'docx')).to.equal(true);
        expect(detectExtMagic(PDF, 'zip')).to.equal(false);
        expect(detectExtMagic(PNG, 'png')).to.equal(true);
        expect(detectExtMagic(JPG, 'jpg')).to.equal(true);
        expectRejected(() => upload({ filename: 'pack.zip', header: PDF }), '扩展名');
    });

    it('rejects oversize files', () => {
        expectRejected(() => upload({ size: COLLECT_HARD_MAX_FILE_BYTES + 1 }), '过大');
    });
});
