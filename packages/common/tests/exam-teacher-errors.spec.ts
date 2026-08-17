import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    examTeacherError,
    examTeacherErrorEn,
    examTeacherErrorZh,
    examTeacherFieldLabel,
    EXAM_TEACHER_UNKNOWN_ERROR_ZH,
} from '../exam-teacher-errors';

describe('exam teacher error copy', () => {
    it('maps HTTP fields to Chinese labels', () => {
        expect(examTeacherFieldLabel('examPrelogin')).to.equal('考试预登录');
        expect(examTeacherFieldLabel('examSeatPlan')).to.equal('座位计划');
        expect(examTeacherFieldLabel('examSeatAssignment')).to.equal('座位分配');
        expect(examTeacherFieldLabel('examEvent')).to.equal('考试活动');
        expect(examTeacherFieldLabel('examNetwork')).to.equal('考试网络');
        expect(examTeacherFieldLabel('examNetworkExecution')).to.equal('考试网络');
        expect(examTeacherFieldLabel('eventId')).to.equal('考试活动');
    });

    it('returns complete Chinese sentences for teacher-facing reasons', () => {
        expect(examTeacherErrorZh('preparation_fingerprint_mismatch')).to.equal(
            '预登录准备指纹与当前预检不一致，请重新预检后再确认。',
        );
        expect(examTeacherErrorZh('candidate_seats_invalid')).to.equal('候选座位列表无效，请重新选择教室或座位。');
        expect(examTeacherErrorZh('contest_not_enterable')).to.equal('当前比赛入口不可用，学生无法进入考试工作台。');
        expect(examTeacherErrorZh('monitoring_preflight_blocked')).to.equal('终端监测预检未通过，已阻止预登录。');
        expect(examTeacherErrorZh('active_session_conflict')).to.equal('终端上已有活动考试会话，无法继续预登录。');
        expect(examTeacherErrorZh('exam_prelogin_retry_blocked:active_session_conflict=3')).to.equal(
            '无法重试预登录：该终端已有活动考试会话 3 台。',
        );
        expect(examTeacherErrorZh('exam_prelogin_retry_blocked:active_session_conflict=2,endpoint_offline=3')).to.equal(
            '无法重试预登录：该终端已有活动考试会话 2 台、终端离线 3 台。',
        );
        expect(examTeacherErrorZh('exam_prelogin_retry_blocked:mystery_reason=4,endpoint_offline=1')).to.equal(
            '无法重试预登录：其它问题 4 台、终端离线 1 台。',
        );
        expect(examTeacherErrorZh('exam_prelogin_retry_blocked:mystery_reason=4,endpoint_offline=1')).not.to.match(
            /mystery_reason|_/,
        );
        expect(examTeacherErrorZh('assignment_reference_changed:prepare:room/A1:uid=8')).to.equal(
            '座位分配引用已变化，请重新预检后再继续。',
        );
    });

    it('does not put snake_case codes in the teacher sentence', () => {
        const unknown = examTeacherError('totally_unknown_exam_reason');
        expect(unknown.zh).to.equal(EXAM_TEACHER_UNKNOWN_ERROR_ZH);
        expect(unknown.code).to.equal('totally_unknown_exam_reason');
        expect(unknown.zh).not.to.match(/_/);
        expect(examTeacherErrorEn('totally_unknown_exam_reason')).not.to.match(/totally_unknown_exam_reason/);
    });
});
