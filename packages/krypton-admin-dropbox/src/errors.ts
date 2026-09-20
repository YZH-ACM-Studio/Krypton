import { CreateError as Err, ForbiddenError, NotFoundError, UserFacingError } from 'hydrooj';

export const AdminDropboxNotFoundError = Err('AdminDropboxNotFoundError', NotFoundError, '文件不存在');
export const AdminDropboxForbiddenError = Err('AdminDropboxForbiddenError', ForbiddenError, '需要系统管理权限');
export const AdminDropboxFileRejectedError = Err('AdminDropboxFileRejectedError', UserFacingError, 'Invalid request: {0}', 400);
export const AdminDropboxExpiredError = Err('AdminDropboxExpiredError', UserFacingError, '文件已过期', 410);
