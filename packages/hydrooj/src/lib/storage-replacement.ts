import type { Readable } from 'stream';
import { localizedErrorText, ValidationError } from '../error';

export interface StoredObjectMeta {
    metaData: unknown;
    size: number;
    etag: string;
}

function isMissingUploadSource(file: string | Buffer | Readable, error: unknown): boolean {
    if (typeof file !== 'string' || !error || typeof error !== 'object') return false;
    if ((error as { code?: unknown }).code === 'ENOENT') return true;
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' && message.startsWith('ENOENT:');
}

/**
 * Write the replacement bytes before retiring the previous object.
 * A missing upload temp must not hide the live file.
 */
export async function replaceStoredObject(
    file: string | Buffer | Readable,
    writeBlob: () => Promise<void>,
    readMeta: () => Promise<StoredObjectMeta>,
    retirePrevious: () => Promise<void>,
    insert: (meta: StoredObjectMeta) => Promise<void>,
): Promise<void> {
    try {
        await writeBlob();
    } catch (error) {
        if (isMissingUploadSource(file, error)) {
            throw new ValidationError('file', null, localizedErrorText`The uploaded file is no longer available. Choose it again and retry.`);
        }
        throw error;
    }
    const meta = await readMeta();
    await retirePrevious();
    await insert(meta);
}
