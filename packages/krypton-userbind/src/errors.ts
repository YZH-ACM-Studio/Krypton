import { CreateError as Err, ForbiddenError } from 'hydrooj';

export const BindingRequiredError = Err('BindingRequiredError', ForbiddenError, '请先绑定学生身份', 403);
