import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { describeHydroError, lookupErrorMessageTranslation, resolveErrorMessage, ValidationError } from '@hydrooj/framework';
import { throwExamTeacherValidationError } from '../src/lib/exam-teacher-http-error';

function resolveThrown(reason: string, field: 'examPrelogin' | 'examSeatPlan' = 'examPrelogin', locale = 'zh-CN') {
    try {
        throwExamTeacherValidationError(field, reason);
    } catch (error) {
        assert.ok(error instanceof ValidationError);
        return resolveErrorMessage(describeHydroError(error), {
            locale,
            lookup: lookupErrorMessageTranslation,
            createTraceId: () => 'exam-teacher-test',
        });
    }
    throw new Error('expected ValidationError');
}

describe('exam teacher HTTP validation messages', () => {
    it('shows a complete Chinese sentence instead of Invalid request: reason', () => {
        const result = resolveThrown('preparation_fingerprint_mismatch');
        assert.equal(result.message, '字段 考试预登录 验证失败。（预登录准备指纹与当前预检不一致，请重新预检后再确认。）');
        assert.equal(result.params[2], '预登录准备指纹与当前预检不一致，请重新预检后再确认。');
        assert.match(String(result.params[2]), /。$/);
        assert.doesNotMatch(result.message, /Invalid request|preparation_fingerprint_mismatch|请求无效：/);
    });

    it('keeps composite retry diagnostics human-readable', () => {
        const result = resolveThrown('exam_prelogin_retry_blocked:active_session_conflict=3');
        assert.equal(result.message, '字段 考试预登录 验证失败。（无法重试预登录：该终端已有活动考试会话 3 台。）');
        assert.doesNotMatch(result.message, /exam_prelogin_retry_blocked|active_session_conflict/);
    });

    it('joins every retry-blocked count into one Chinese sentence', () => {
        const result = resolveThrown('exam_prelogin_retry_blocked:active_session_conflict=2,endpoint_offline=3');
        assert.equal(
            result.message,
            '字段 考试预登录 验证失败。（无法重试预登录：该终端已有活动考试会话 2 台、终端离线 3 台。）',
        );
        assert.match(result.message, /活动考试会话/);
        assert.match(result.message, /离线/);
        assert.doesNotMatch(result.message, /exam_prelogin_retry_blocked|active_session_conflict|endpoint_offline/);
    });

    it('does not leak an unknown reason code to teachers', () => {
        const result = resolveThrown('candidate_seats_please_explode', 'examSeatPlan');
        assert.equal(result.message, '字段 座位计划 验证失败。（操作无法完成，请重试或联系管理员。）');
        assert.doesNotMatch(result.message, /candidate_seats_please_explode|_/);
    });

    it('translates the same Chinese source into English', () => {
        const result = resolveThrown('candidate_seats_invalid', 'examSeatPlan', 'en');
        assert.equal(
            result.message,
            'Field 座位计划 validation failed. (The candidate seat list is invalid. Select classrooms or seats again.)',
        );
    });
});
