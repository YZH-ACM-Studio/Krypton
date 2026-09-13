/**
 * Mongo collection + indexes for the admin temporary dropbox.
 *
 * Collection: `admin.dropbox_files`. Never reuse `collect.*`.
 * expireAt is indexed for application cleanup of blob + metadata together.
 * Do not attach expireAfterSeconds: Hydro's expireAfter fallback would
 * delete metadata and leave orphan blobs.
 */
import { db } from 'hydrooj';
import { ADMIN_DROPBOX_COLLECTION, type AdminDropboxFileDoc } from './types';

export const dropboxFilesColl = db.collection<AdminDropboxFileDoc>(ADMIN_DROPBOX_COLLECTION);

let indexesEnsured = false;

export async function ensureIndexes(): Promise<void> {
    if (indexesEnsured) return;
    try {
        await Promise.all([
            dropboxFilesColl.createIndex(
                { domainId: 1, createdAt: -1 },
                { name: 'admin_dropbox_domain_created' },
            ),
            dropboxFilesColl.createIndex(
                { expireAt: 1 },
                { name: 'admin_dropbox_expireAt' },
            ),
            dropboxFilesColl.createIndex(
                { storagePath: 1 },
                { name: 'admin_dropbox_storage_path_uq', unique: true },
            ),
        ]);
        indexesEnsured = true;
    } catch (error) {
        indexesEnsured = false;
        throw error;
    }
}
