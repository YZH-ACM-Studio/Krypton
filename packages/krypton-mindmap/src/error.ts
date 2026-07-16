import { CreateError as Err, UserFacingError } from 'hydrooj';

/** A user-correctable malformed mindmap request. */
export const MindmapRequestError = Err(
    'MindmapRequestError',
    UserFacingError,
    function (this: { params: unknown[] }) {
        return String(this.params[0] || '导图请求无效');
    },
    400,
);

/** A stale edit or a mutation blocked by the live tree/reference state. */
export const MindmapConflictError = Err(
    'MindmapConflictError',
    UserFacingError,
    function (this: { params: unknown[] }) {
        return String(this.params[0] || '导图已发生变化，请刷新后重试');
    },
    409,
);
