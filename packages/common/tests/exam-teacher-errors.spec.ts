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
        expect(unknown.zh).not.to.match(/未知诊断/);
        expect(examTeacherErrorEn('totally_unknown_exam_reason')).not.to.match(/totally_unknown_exam_reason/);
        expect(examTeacherErrorZh('totally_unknown_exam_reason')).to.equal('操作无法完成，请重试或联系管理员。');
    });

    it('keeps existing catalog sentences when page labels diverge', () => {
        expect(examTeacherErrorZh('contest_not_enterable')).to.equal('当前比赛入口不可用，学生无法进入考试工作台。');
        expect(examTeacherErrorZh('endpoint_offline')).to.equal('终端当前离线，无法继续。');
        expect(examTeacherErrorZh('endpoint_incompatible')).to.equal('终端版本或协议不兼容，无法继续。');
        expect(examTeacherErrorZh('endpoint_capability_missing')).to.equal('终端缺少必要能力，无法继续。');
        expect(examTeacherErrorZh('active_session_conflict')).to.equal('终端上已有活动考试会话，无法继续预登录。');
        expect(examTeacherErrorZh('assignment_already_confirmed')).to.equal('该座位分配已经确认过预登录，不能再创建新的批次。');
        expect(examTeacherErrorZh('assignment_reference_changed')).to.equal('座位分配引用已变化，请重新预检后再继续。');
        expect(examTeacherErrorZh('batch_not_found')).to.equal('预登录批次不存在。');
        expect(examTeacherErrorZh('exam_prelogin_retry_blocked')).to.equal('无法重试预登录。请查看终端预检结果后再重试失败项。');
        expect(examTeacherErrorZh('vigil_delivery_unknown')).to.equal('无法确认 Vigil 是否收到请求，请查询当前状态后再决定是否重试。');
        expect(examTeacherErrorZh('vigil_http_rejected')).to.equal('Vigil 拒绝了本次请求。');
        expect(examTeacherErrorZh('workflow_not_ready')).to.equal('一键预登录检查未通过，请先处理网络、监测或终端硬错误。');
        expect(examTeacherErrorZh('network_execution_not_ready')).to.equal('考试网络执行尚未就绪，不能开始预登录。');
        expect(examTeacherErrorZh('network_execution_not_active')).to.equal('考试网络执行未处于活动状态。');
        expect(examTeacherErrorZh('network_execution_expired')).to.equal('考试网络执行已过期。');
        expect(examTeacherErrorZh('network_execution_failed')).to.equal('考试网络执行存在失败终端。');
        expect(examTeacherErrorZh('network_execution_pending')).to.equal('考试网络执行尚未完成。');
        expect(examTeacherErrorZh('preparation_fingerprint_changed')).to.equal('预登录准备指纹与当前预检不一致，请重新预检后再确认。');
        expect(examTeacherErrorZh('workflow_fingerprint_changed')).to.equal('预登录工作流指纹已变化，请重新预检后再确认。');
        expect(examTeacherErrorZh('exam_prelogin_activity_changed')).to.equal('考试预登录相关事实已变化，请重新预检后再继续。');
        expect(examTeacherErrorZh('exam_prelogin_assignment_not_found')).to.equal('座位分配不存在。');
        expect(examTeacherErrorZh('exam_prelogin_assignment_not_published')).to.equal('座位分配尚未发布，不能预登录。');
        expect(examTeacherErrorZh('external_workspace_unavailable')).to.equal('外部考试没有可用的本站考试工作台，不能预登录。');
        expect(examTeacherErrorZh('exam_prelogin_retry_readiness_invalid')).to.equal('预登录重试就绪检查结果无效。');
        expect(examTeacherErrorZh('user_binding_changed')).to.equal('学生账号绑定已变化，请重新预检后再继续。');
        expect(examTeacherErrorZh('seat_binding_changed')).to.equal('座位绑定已变化，请重新预检后再继续。');
        expect(examTeacherErrorZh('seat_facing_changed')).to.equal('座位朝向已变化。这不影响已发布的分配，但请确认教室朝向设置。');
    });

    it('uses current page Chinese for newly cataloged diagnostic codes', () => {
        expect(examTeacherErrorZh('endpoint_not_registered')).to.equal('终端尚未登记');
        expect(examTeacherErrorZh('endpoint_credential_not_active')).to.equal('终端凭据不是活动状态');
        expect(examTeacherErrorZh('endpoint_offline_before_send')).to.equal('发送前终端已离线');
        expect(examTeacherErrorZh('ready')).to.equal('就绪');
        expect(examTeacherErrorZh('initialized')).to.equal('本机网络锁已初始化，当前没有活动');
        expect(examTeacherErrorZh('transport_send_failed_delivery_unknown')).to.equal('发送结果未知');
        expect(examTeacherErrorZh('vigil_dispatch_incomplete')).to.equal('命令尚未全部派发完成');
        expect(examTeacherErrorZh('network_platform_clear_failed')).to.equal('未能清理终端网络规则');
        expect(examTeacherErrorZh('network_activity_not_active')).to.equal('本机没有这场网络锁，整盘还原后需再点一次停止');
        expect(examTeacherErrorZh('network_stop_reaffirmation_mismatch')).to.equal('本机残留的停止证明和当前策略不一致，常见于整盘还原');
        expect(examTeacherErrorZh('network_stop_managed_filters_without_activity')).to.equal('本机没有活动记录，但仍有托管网络规则');
        expect(examTeacherErrorZh('authorized_stop_empty_owner')).to.equal('已按空 owner 认领停止');
        expect(examTeacherErrorZh('authorized_stop_empty_owner_pending')).to.equal('已按空 owner 认领停止');
        expect(examTeacherErrorZh('constraint_conflict')).to.equal('约束冲突');
        expect(examTeacherErrorZh('detector_degraded')).to.equal('检测不完整');
        expect(examTeacherErrorZh('detector_failed')).to.equal('检测失败');
        expect(examTeacherErrorZh('detector_unsupported')).to.equal('检测不受支持');
        expect(examTeacherErrorZh('duplicate_fixed_seat')).to.equal('多个学生被指定到同一座位');
        expect(examTeacherErrorZh('duplicate_seat')).to.equal('存在重复座位');
        expect(examTeacherErrorZh('duplicate_uid')).to.equal('存在重复学生');
        expect(examTeacherErrorZh('forbidden_process_detected')).to.equal('检测到禁用进程');
        expect(examTeacherErrorZh('forbidden_window_detected')).to.equal('检测到可疑前台窗口');
        expect(examTeacherErrorZh('locked_manual_mismatch')).to.equal('锁定座位与人工映射不一致');
        expect(examTeacherErrorZh('locked_seat_unavailable')).to.equal('锁定的座位当前不可分配');
        expect(examTeacherErrorZh('locked_uid_missing')).to.equal('锁定座位对应的学生已不在名单中');
        expect(examTeacherErrorZh('manual_mapping_incomplete')).to.equal('人工映射不完整');
        expect(examTeacherErrorZh('manual_seat_unavailable')).to.equal('人工指定的座位当前不可分配');
        expect(examTeacherErrorZh('manual_uid_missing')).to.equal('人工指定的学生已不在名单中');
        expect(examTeacherErrorZh('monitoring_failed')).to.equal('监测失败');
        expect(examTeacherErrorZh('monitoring_unavailable')).to.equal('监测不可用');
        expect(examTeacherErrorZh('page_launch_failed')).to.equal('未能打开考试页面');
        expect(examTeacherErrorZh('process_launch_failed')).to.equal('未能拉起考试客户端');
        expect(examTeacherErrorZh('process_path_partial_access_denied')).to.equal('无法读取部分系统进程路径');
        expect(examTeacherErrorZh('process_path_partial_query_failed')).to.equal('无法读取部分系统进程路径');
        expect(examTeacherErrorZh('process_snapshot_failed')).to.equal('无法获取系统进程快照');
        expect(examTeacherErrorZh('process_snapshot_read_failed')).to.equal('无法读取系统进程列表');
        expect(examTeacherErrorZh('result_not_bijective')).to.equal('分配结果不是一一对应');
        expect(examTeacherErrorZh('usb_storage_detected')).to.equal('检测到可移动存储设备');
    });
});
