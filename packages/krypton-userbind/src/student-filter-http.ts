import { BadRequestError, localizedErrorText, localizeError } from 'hydrooj';
import type { ParsedStudentFilterQuery, StudentFilterQueryInput } from './student-filter';
import { parseStudentFilterQuery, StudentFilterValidationError } from './student-filter';

function localizedStudentFilterDetail(error: StudentFilterValidationError): InstanceType<typeof BadRequestError> {
    if (error.message === `${error.field} 参数格式非法`) {
        return new BadRequestError(localizedErrorText`${error.field} 参数格式非法`);
    }
    if (error.message === `${error.field} 日期格式非法`) {
        return new BadRequestError(localizedErrorText`${error.field} 日期格式非法`);
    }
    switch (error.message) {
        case '日期必须为 YYYY-MM-DD':
            return new BadRequestError(localizedErrorText`日期必须为 YYYY-MM-DD`);
        case '日期不是有效的日历日期':
            return new BadRequestError(localizedErrorText`日期不是有效的日历日期`);
        case '入学年必须是 1900–2099 的四位十进制年份':
            return new BadRequestError(localizedErrorText`入学年必须是 1900–2099 的四位十进制年份`);
        case '绑定状态参数非法':
            return new BadRequestError(localizedErrorText`绑定状态参数非法`);
        case '时间字段参数非法':
            return new BadRequestError(localizedErrorText`时间字段参数非法`);
        case '开始日期不能晚于结束日期':
            return new BadRequestError(localizedErrorText`开始日期不能晚于结束日期`);
        default:
            throw new TypeError(`Unmapped StudentFilterValidationError detail: ${error.message}`, { cause: error });
    }
}

/** Convert pure filter validation failures into the HTTP layer's explicit 400. */
export function parseAdminStudentFilters(input: StudentFilterQueryInput): ParsedStudentFilterQuery {
    try {
        return parseStudentFilterQuery(input);
    } catch (error) {
        if (error instanceof StudentFilterValidationError) {
            const detail = localizedStudentFilterDetail(error);
            throw localizeError(new BadRequestError(error.field, null, error.message), 'Invalid request: {0}. {1}', error.field, detail);
        }
        throw error;
    }
}
