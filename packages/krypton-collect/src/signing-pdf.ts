import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { deflateSync, inflateSync } from 'node:zlib';
import fontkit from '@pdf-lib/fontkit';
import { unzipSync } from 'fflate';
import { degrees, PDFDocument, PDFName, PDFNumber, type PDFFont } from 'pdf-lib';
import { CollectFileRejectedError } from './errors';
import type { SigningField, SigningIdentity, SigningPage } from './signing-types';

const run = promisify(execFile);
export const FONT_SHA = 'd68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964';
export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function reject(message: string): never {
    throw new CollectFileRejectedError(message);
}
let workers = 0;

export async function withSigningWorker<T>(fn: () => Promise<T>): Promise<T> {
    if (workers >= 2) reject('签署服务正忙，请稍后重试，当前笔迹会保留');
    workers++;
    try {
        return await fn();
    } finally {
        workers--;
    }
}

export async function signingFont(): Promise<Buffer> {
    const bytes = await readFile(join(__dirname, '../assets/NotoSansSC-VF.ttf'));
    if (sha256(bytes) !== FONT_SHA) throw new Error('Signing font checksum mismatch');
    return bytes;
}

export async function prepareSigningPdf(source: Buffer, ext: 'pdf' | 'docx') {
    if (!source.length || source.length > 32 * 1024 * 1024) reject('文档大小须在 32 MB 以内');
    let bytes = source;
    if (ext === 'docx') {
        let total = 0;
        let count = 0;
        const entries = unzipSync(source, {
            filter: (entry) => {
                total += entry.originalSize;
                if (++count > 2048 || total > 64 * 1024 * 1024) reject('DOCX 解压后过大，请改为上传 PDF');
                if (/vbaProject|embeddings\/|activeX\//i.test(entry.name)) reject('DOCX 不支持宏或嵌入对象，请改为上传 PDF');
                return /\.(?:xml|rels)$/i.test(entry.name);
            },
        });
        if (!entries['word/document.xml']) reject('不是有效的 DOCX 文档');
        for (const entry of Object.values(entries)) {
            const xml = Buffer.from(entry).toString('utf8');
            if (/<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External|<\w+:altChunk\b/i.test(xml)) {
                reject('DOCX 含外部引用或嵌入内容，请先导出 PDF 再上传');
            }
        }
        const dir = await mkdtemp(join(tmpdir(), 'krypton-sign-'));
        try {
            await writeFile(join(dir, 'document.docx'), source);
            const fonts = join(dir, '.local/share/fonts');
            await mkdir(fonts, { recursive: true });
            await writeFile(join(fonts, 'NotoSansSC-VF.ttf'), await signingFont());
            const args = [
                `-env:UserInstallation=file://${dir}/profile`,
                '--headless',
                '--convert-to',
                'pdf',
                '--outdir',
                dir,
                join(dir, 'document.docx'),
            ];
            if (process.platform === 'linux') {
                await run(
                    '/usr/bin/bwrap',
                    [
                        '--unshare-all',
                        '--die-with-parent',
                        '--new-session',
                        '--ro-bind',
                        '/',
                        '/',
                        '--tmpfs',
                        '/tmp',
                        '--tmpfs',
                        '/root',
                        '--tmpfs',
                        '/home',
                        '--tmpfs',
                        '/data',
                        '--proc',
                        '/proc',
                        '--dev',
                        '/dev',
                        '--bind',
                        dir,
                        dir,
                        '--setenv',
                        'HOME',
                        dir,
                        '/usr/bin/soffice',
                        ...args,
                    ],
                    { timeout: 45000, maxBuffer: 1024 * 1024 },
                );
            } else await run('/opt/homebrew/bin/soffice', args, { timeout: 45000, maxBuffer: 1024 * 1024 });
            bytes = await readFile(join(dir, 'document.pdf'));
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }
    if (bytes.length > 32 * 1024 * 1024) reject('转换后的 PDF 超过 32 MB');
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    if (!pdf.getPageCount() || pdf.getPageCount() > 50) reject('知情书须在 1 到 50 页之间');
    const pages: SigningPage[] = pdf.getPages().map((page) => {
        const box = page.getCropBox();
        const rotation = ((page.getRotation().angle % 360) + 360) % 360;
        const unit = page.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber)?.asNumber() || 1;
        if (
            ![0, 90, 180, 270].includes(rotation) ||
            !Number.isFinite(unit) ||
            unit <= 0 ||
            box.width <= 0 ||
            box.height <= 0 ||
            Math.max(box.width, box.height) * unit > 14400
        ) { reject('PDF 页面尺寸或旋转不受支持'); }
        return { ...box, rotation, userUnit: unit };
    });
    return { bytes, pages };
}

function crc32(bytes: Buffer) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(type), data]);
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length);
    body.copy(result, 4);
    result.writeUInt32BE(crc32(body), result.length - 4);
    return result;
}

/** Decode only bounded, non-interlaced browser PNGs; crop ink and discard ancillary chunks. */
export function cleanSignature(value: unknown): Buffer {
    if (typeof value !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value) || value.length > 1400000) { reject('签名图片格式或大小不正确'); }
    const bytes = Buffer.from(value.slice('data:image/png;base64,'.length), 'base64');
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) reject('签名须为 PNG 图片');
    let width = 0;
    let height = 0;
    let channels = 0;
    const chunks: Buffer[] = [];
    let ended = false;
    for (let offset = 8; offset < bytes.length;) {
        if (offset + 12 > bytes.length) reject('签名 PNG 不完整');
        const length = bytes.readUInt32BE(offset);
        const end = offset + 12 + length;
        if (end > bytes.length) reject('签名 PNG 不完整');
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        const data = bytes.subarray(offset + 8, end - 4);
        if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) reject('签名 PNG 校验失败');
        if (offset === 8 && type !== 'IHDR') reject('签名 PNG 缺少图片尺寸');
        if (type === 'IHDR') {
            if (width || length !== 13) reject('签名 PNG 头不正确');
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
            if (
                !width ||
                !height ||
                width > 4096 ||
                height > 2048 ||
                width * height > 2000000 ||
                data[8] !== 8 ||
                !channels ||
                data[10] ||
                data[11] ||
                data[12]
            ) { reject('签名图片尺寸或编码不受支持'); }
        } else if (type === 'IDAT') chunks.push(data);
        else if (type === 'IEND') {
            ended = end === bytes.length;
            break;
        } else if (type[0] === type[0].toUpperCase()) reject('签名 PNG 含不支持的数据');
        offset = end;
    }
    if (!ended || !chunks.length) reject('签名 PNG 不完整');
    const stride = width * channels;
    const raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * height });
    if (raw.length !== (stride + 1) * height) reject('签名 PNG 像素长度不正确');
    const pixels = Buffer.alloc(stride * height);
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    let ink = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        if (filter > 4) reject('签名 PNG 滤波类型不正确');
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? pixels[y * stride + x - channels] : 0;
            const b = y ? pixels[(y - 1) * stride + x] : 0;
            const c = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            const predictor =
                filter === 1
                    ? a
                    : filter === 2
                      ? b
                      : filter === 3
                        ? Math.floor((a + b) / 2)
                        : filter === 4
                          ? pa <= pb && pa <= pc
                              ? a
                              : pb <= pc
                                ? b
                                : c
                          : 0;
            pixels[y * stride + x] = (raw[y * (stride + 1) + x + 1] + predictor) & 255;
        }
        for (let x = 0; x < width; x++) {
            const pos = y * stride + x * channels;
            if ((channels === 3 || pixels[pos + 3] > 64) && Math.min(pixels[pos], pixels[pos + 1], pixels[pos + 2]) < 200) {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
                ink++;
            }
        }
    }
    if (ink < 40 || maxX - minX < 12 || maxY - minY < 6) reject('请在签名框内写下完整姓名');
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const cropped = Buffer.alloc((w * channels + 1) * h);
    for (let y = 0; y < h; y++) { pixels.copy(cropped, y * (w * channels + 1) + 1, (y + minY) * stride + minX * channels, (y + minY) * stride + (maxX + 1) * channels); }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(w, 0);
    header.writeUInt32BE(h, 4);
    header[8] = 8;
    header[9] = channels === 4 ? 6 : 2;
    return Buffer.concat([bytes.subarray(0, 8), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(cropped)), pngChunk('IEND', Buffer.alloc(0))]);
}

async function signingPdfWithFont(source: Buffer, fontBytes: Buffer) {
    const pdf = await PDFDocument.load(source, { updateMetadata: false });
    pdf.registerFontkit({
        create: (bytes) => {
            const font = fontkit.create(bytes);
            if (!('getVariation' in font) || typeof font.getVariation !== 'function') throw new Error('Signing font has no variation support');
            return font.getVariation({ wght: 400 });
        },
    });
    const font = await pdf.embedFont(fontBytes, { subset: true });
    return { pdf, font };
}

function fittedTextSize(text: string, field: SigningField, width: number, height: number, font: PDFFont) {
    if (!text.trim() || [...text].some((char) => char.charCodeAt(0) < 32)) reject('身份信息缺失或含控制字符，请联系管理员');
    const size = Math.min(field.fontSize, width / Math.max(font.widthOfTextAtSize(text, 1), 0.01), height / 1.2);
    if (size < 6) reject('签署文字框太小，无法完整放入身份信息，请扩大标定区域');
    return size;
}

export async function validateSigningTextLayout(source: Buffer, fontBytes: Buffer, fields: SigningField[], identities: Pick<SigningIdentity, 'studentId' | 'realName'>[]) {
    const { pdf, font } = await signingPdfWithFont(source, fontBytes);
    const rows = identities.length ? identities : [{ studentId: '202600000000', realName: '姓名示例' }];
    for (const field of fields) {
        if (field.kind === 'signature') continue;
        const swap = pdf.getPage(field.page - 1).getRotation().angle % 180 !== 0;
        const key = field.kind;
        const values = key === 'signedAt' ? ['8888-88-88 88:88:88'] : rows.map((row) => row[key]);
        for (const value of values) fittedTextSize(value, field, swap ? field.height : field.width, swap ? field.width : field.height, font);
    }
}

export async function renderSignedPdf(
    source: Buffer,
    fontBytes: Buffer,
    fields: SigningField[],
    identity: Pick<SigningIdentity, 'studentId' | 'realName'>,
    signedAt: Date,
    signature: Buffer,
) {
    const { pdf, font } = await signingPdfWithFont(source, fontBytes);
    const image = await pdf.embedPng(signature);
    const values = {
        studentId: identity.studentId,
        realName: identity.realName,
        signedAt: new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        }).format(signedAt),
    };
    for (const field of fields) {
        const page = pdf.getPage(field.page - 1);
        const angle = ((page.getRotation().angle % 360) + 360) % 360;
        const swap = angle === 90 || angle === 270;
        const width = swap ? field.height : field.width;
        const height = swap ? field.width : field.height;
        const origin =
            angle === 90
                ? [field.x + field.width, field.y]
                : angle === 180
                  ? [field.x + field.width, field.y + field.height]
                  : angle === 270
                    ? [field.x, field.y + field.height]
                    : [field.x, field.y];
        const radians = (angle * Math.PI) / 180;
        const point = (x: number, y: number) => ({
            x: origin[0] + x * Math.cos(radians) - y * Math.sin(radians),
            y: origin[1] + x * Math.sin(radians) + y * Math.cos(radians),
        });
        if (field.kind === 'signature') {
            const scale = Math.min(width / image.width, height / image.height);
            const w = image.width * scale;
            const h = image.height * scale;
            page.drawImage(image, { ...point((width - w) / 2, (height - h) / 2), width: w, height: h, rotate: degrees(angle) });
        } else {
            const text = values[field.kind];
            const size = fittedTextSize(text, field, width, height, font);
            page.drawText(text, { ...point(0, (height - size) / 2 + size * 0.18), font, size, rotate: degrees(angle) });
        }
    }
    pdf.setCreationDate(signedAt);
    pdf.setModificationDate(signedAt);
    pdf.setProducer('Krypton');
    pdf.setCreator('Krypton');
    return Buffer.from(await pdf.save());
}
