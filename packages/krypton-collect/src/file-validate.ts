import { CollectFileRejectedError } from './errors';
import {
    COLLECT_HARD_MAX_FILE_BYTES,
    COLLECT_REJECTED_EXTS,
    isAllowedExt,
    normalizeExt,
    type CollectAllowedExt,
    type CollectSlot,
} from './types';

const PDF_MAGIC = Uint8Array.of(0x25, 0x50, 0x44, 0x46); // %PDF
const PNG_MAGIC = Uint8Array.of(0x89, 0x50, 0x4e, 0x47);
const JPG_MAGIC = Uint8Array.of(0xff, 0xd8);
const ZIP_MAGICS = [
    Uint8Array.of(0x50, 0x4b, 0x03, 0x04),
    Uint8Array.of(0x50, 0x4b, 0x05, 0x06),
    Uint8Array.of(0x50, 0x4b, 0x07, 0x08),
];

function headerStartsWith(header: Uint8Array, magic: Uint8Array): boolean {
    if (header.length < magic.length) return false;
    for (let i = 0; i < magic.length; i += 1) {
        if (header[i] !== magic[i]) return false;
    }
    return true;
}

export function detectExtMagic(header: Uint8Array, claimedExt: string): boolean {
    const claimed = claimedExt.trim().toLowerCase();
    const ext = claimed === 'jpeg' ? 'jpg' : claimed;
    if (ext === 'pdf') return headerStartsWith(header, PDF_MAGIC);
    if (ext === 'png') return headerStartsWith(header, PNG_MAGIC);
    if (ext === 'jpg') return headerStartsWith(header, JPG_MAGIC);
    if (ext === 'zip' || ext === 'docx') return ZIP_MAGICS.some((magic) => headerStartsWith(header, magic));
    return false;
}

function reject(message: string): never {
    if (typeof CollectFileRejectedError !== 'function') throw new Error(message);
    throw new CollectFileRejectedError(message);
}

export function assertUploadAllowed(args: {
    filename: string;
    size: number;
    slot: Pick<CollectSlot, 'allowedExt'>;
    header: Uint8Array;
}): { ext: CollectAllowedExt; originalName: string } {
    const originalName = args.filename.trim();
    if (!originalName) reject('文件名无效');

    const ext = normalizeExt(originalName);
    if (!ext || (COLLECT_REJECTED_EXTS as readonly string[]).includes(ext)) reject('不允许的文件类型');
    if (!isAllowedExt(ext, args.slot)) reject('不允许的文件类型');

    if (!Number.isFinite(args.size) || args.size <= 0) reject('空文件');
    if (args.size > COLLECT_HARD_MAX_FILE_BYTES) reject('文件过大');
    if (!detectExtMagic(args.header, ext)) reject('文件内容与扩展名不符');

    return { ext, originalName };
}
