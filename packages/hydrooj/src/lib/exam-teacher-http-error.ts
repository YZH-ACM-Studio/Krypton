import { examTeacherErrorZh, examTeacherFieldLabel, examTeacherRetryBlockedDetailZh, type ExamTeacherField } from '@hydrooj/common';
import { LocalizedErrorText, localizedErrorText, ValidationError } from '@hydrooj/framework';

function sourceLocalizedErrorText(template: string): LocalizedErrorText {
    const strings = [template] as unknown as TemplateStringsArray;
    Object.defineProperty(strings, 'raw', { value: [template] });
    return new LocalizedErrorText(strings, []);
}

export function examTeacherLocalizedError(reason: string): LocalizedErrorText {
    const retryDetail = examTeacherRetryBlockedDetailZh(reason);
    if (retryDetail !== null) return localizedErrorText`无法重试预登录：${retryDetail}。`;
    return sourceLocalizedErrorText(examTeacherErrorZh(reason));
}

export function throwExamTeacherValidationError(field: ExamTeacherField, reason: string): never {
    throw new ValidationError(examTeacherFieldLabel(field), null, examTeacherLocalizedError(reason));
}
