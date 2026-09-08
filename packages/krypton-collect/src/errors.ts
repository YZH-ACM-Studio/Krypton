import { CreateError as Err, ForbiddenError, NotFoundError, UserFacingError } from 'hydrooj';

export const CollectNotFoundError = Err('CollectNotFoundError', NotFoundError, '文件收集不存在');
export const CollectForbiddenError = Err('CollectForbiddenError', ForbiddenError, '{0}');
export const CollectClosedError = Err('CollectClosedError', ForbiddenError, '收集已截止或已关闭');
export const CollectAudienceEmptyError = Err('CollectAudienceEmptyError', UserFacingError, '所选用户组没有已绑定的学生，不能发布', 400);
export const CollectSlotLockedError = Err('CollectSlotLockedError', UserFacingError, '已有人提交，不能再改槽位或类型', 409);
export const CollectFileRejectedError = Err('CollectFileRejectedError', UserFacingError, '{0}', 400);
export const CollectRevisionConflictError = Err('CollectRevisionConflictError', UserFacingError, '收集已被他人更新，请刷新后重试', 409);
export const CollectNudgeRateError = Err('CollectNudgeRateError', UserFacingError, '催未交过于频繁，请稍后再试', 429);
