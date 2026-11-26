import { createHash } from 'node:crypto';
import { CollectFileRejectedError } from './errors';
import { SIGNING_FIELD_KINDS } from './signing-types';
import type { SigningDocument, SigningField, SigningPage, SigningState } from './signing-types';

function invalid(message: string): never {
    throw new CollectFileRejectedError(message);
}

export function parseSigningFields(value: unknown, pages: SigningPage[]): SigningField[] {
    if (!Array.isArray(value) || value.length > 32) invalid('签署位置必须是最多 32 项的列表');
    return value.map((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('签署位置格式不正确');
        const field: Record<string, unknown> = raw;
        if (Object.keys(field).some((key) => !['kind', 'page', 'x', 'y', 'width', 'height', 'fontSize'].includes(key))) {
            invalid('签署位置包含不支持的字段');
        }
        const kind = SIGNING_FIELD_KINDS.find((item) => item === field.kind);
        if (!kind) invalid('签署字段只支持学号、姓名、时间和手写签名');
        const page = field.page;
        if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > pages.length) invalid('签署页码不正确');
        const { x, y, width, height } = field;
        if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number'
            || ![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) invalid('签署位置和尺寸不正确');
        const box = pages[page - 1];
        if (x < box.x || y < box.y || x + width > box.x + box.width || y + height > box.y + box.height) {
            invalid('签署位置超出文档可见页面');
        }
        const fontSize = field.fontSize === undefined ? 12 : field.fontSize;
        if (typeof fontSize !== 'number' || !Number.isFinite(fontSize) || fontSize < 8 || fontSize > 48) {
            invalid('签署文字大小必须在 8 到 48 之间');
        }
        return { kind, page, x, y, width, height, fontSize };
    });
}

export function signingFingerprint(document: Pick<SigningDocument, 'source' | 'pdf' | 'font' | 'pages' | 'fields'>): string {
    return createHash('sha256').update(JSON.stringify({
        schema: 1,
        source: document.source.sha256,
        pdf: document.pdf.sha256,
        font: document.font.sha256,
        fontWeight: 400,
        pages: document.pages,
        fields: parseSigningFields(document.fields, document.pages),
    })).digest('hex');
}

export function assertSigningDocumentReady(document: SigningDocument | undefined): asserts document is SigningDocument {
    if (!document) invalid('请先上传并检查待签文档');
    if (!document.pages.length || document.pages.some((page) => ![page.x, page.y, page.width, page.height, page.userUnit].every(Number.isFinite)
        || page.width <= 0 || page.height <= 0 || page.userUnit <= 0 || ![0, 90, 180, 270].includes(page.rotation))) {
        invalid('待签文档的页面信息不正确');
    }
    for (const asset of [document.source, document.pdf, document.font]) {
        if (!/^[a-f0-9]{64}$/.test(asset.sha256) || !asset.storagePath.startsWith('collect/')
            || !Number.isSafeInteger(asset.size) || asset.size <= 0) invalid('待签文档的文件信息不正确');
    }
    const fields = parseSigningFields(document.fields, document.pages);
    if (SIGNING_FIELD_KINDS.some((kind) => !fields.some((field) => field.kind === kind))) {
        invalid('请标定学号、姓名、时间和手写签名的位置');
    }
    const fingerprint = signingFingerprint(document);
    if (document.fingerprint !== fingerprint || document.confirmedFingerprint !== fingerprint) {
        invalid('文档或签署位置已变化，请重新预览确认后发布');
    }
}

export function signingRoundOpen(state: SigningState): boolean {
    if (!state || !Number.isSafeInteger(state.generation) || state.generation < 0
        || (state.signedGeneration !== null && (!Number.isSafeInteger(state.signedGeneration)
            || state.signedGeneration < 0 || state.signedGeneration > state.generation))) {
        throw new TypeError('签署版本状态不正确');
    }
    return state.signedGeneration !== state.generation;
}
