/**
 * Admin dropbox authorization.
 *
 * G6: only `PRIV_EDIT_SYSTEM`. Domain perms including `PERM_CREATE_COLLECT`
 * do not grant access. Teachers without system privilege cannot upload.
 */
import { PRIV } from 'hydrooj';

export type AdminDropboxAuthUser = { hasPriv(p: number): boolean };

export function canUseAdminDropbox(user: AdminDropboxAuthUser): boolean {
    return user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}
