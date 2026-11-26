import { localizedErrorText, ValidationError } from '../error';

export interface CollectSigningReturn { path: string; requestId: string }

/** The destination is context for this request, never a shared session redirect. */
export function parseCollectSigningReturn(value: unknown, domainId: string): CollectSigningReturn | null {
    if (value === undefined || value === null) return null;
    const match = typeof value === 'string' && value.match(/^\/(?:d\/([^/%?#\\]+)\/)?collect\/([a-f0-9]{24})\/sign$/);
    if (!match || match[0] !== value || (match[1] && match[1] !== domainId)) {
        throw new ValidationError('collectSign', null, localizedErrorText`签署链接无效，请重新打开管理员提供的活动链接。`);
    }
    return { path: match[0], requestId: match[2] };
}

export function collectSigningReturnFromPath(path: string, domainId: string): CollectSigningReturn | null {
    if (!/^\/(?:d\/[^/]+\/)?collect\/[^/]+\/sign$/.test(path)) return null;
    return parseCollectSigningReturn(path, domainId);
}

export function withCollectSigningReturn(url: string, destination: string | null | undefined): string {
    return destination ? `${url}${url.includes('?') ? '&' : '?'}collectSign=${encodeURIComponent(destination)}` : url;
}
