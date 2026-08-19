export const EXAM_TEACHER_FIELD_LABELS = Object.freeze({
    examEvent: '考试活动',
    examSeatPlan: '座位计划',
    examSeatAssignment: '座位分配',
    examPrelogin: '考试预登录',
    examNetwork: '考试网络',
    examNetworkExecution: '考试网络',
    eventId: '考试活动',
});

export type ExamTeacherField = keyof typeof EXAM_TEACHER_FIELD_LABELS;

export const EXAM_TEACHER_UNKNOWN_ERROR_ZH = '操作无法完成，请重试或联系管理员。';
export const EXAM_TEACHER_UNKNOWN_ERROR_EN = 'The operation could not be completed. Retry or contact an administrator.';

interface ExamTeacherErrorText {
    zh: string;
    en: string;
}

const DATA_INVALID: ExamTeacherErrorText = {
    zh: '提交的数据无效，请刷新页面后重试。',
    en: 'The submitted data is invalid. Reload the page and try again.',
};
const DATA_DUPLICATE: ExamTeacherErrorText = {
    zh: '提交的数据包含重复项，请检查后重试。',
    en: 'The submitted data contains duplicates. Check it and try again.',
};
const DATA_MISMATCH: ExamTeacherErrorText = {
    zh: '提交的数据与当前记录不一致，请刷新后重试。',
    en: 'The submitted data does not match the current record. Reload and try again.',
};
const REVISION_CONFLICT: ExamTeacherErrorText = {
    zh: '数据版本冲突，请刷新页面后重试。',
    en: 'The data version conflicts. Reload the page and try again.',
};
const FINGERPRINT_CHANGED: ExamTeacherErrorText = {
    zh: '当前预检结果已过期，请重新预检后再继续。',
    en: 'The current preflight result is stale. Run preflight again before continuing.',
};
const NOT_FOUND: ExamTeacherErrorText = {
    zh: '未找到对应记录，请刷新页面后重试。',
    en: 'The requested record was not found. Reload the page and try again.',
};
const EVENT_ARCHIVED: ExamTeacherErrorText = {
    zh: '考试活动已归档，不能再修改。',
    en: 'This exam event is archived and can no longer be changed.',
};
const EVENT_NOT_FOUND: ExamTeacherErrorText = {
    zh: '考试活动不存在。',
    en: 'The exam event does not exist.',
};
const EVENT_CANONICAL_INVALID: ExamTeacherErrorText = {
    zh: '考试活动数据不完整或已损坏，请刷新后重试。',
    en: 'The exam event data is incomplete or corrupted. Reload and try again.',
};
const SCHOOL_MISMATCH: ExamTeacherErrorText = {
    zh: '学校与考试活动不一致，不能继续。',
    en: 'The school does not match this exam event.',
};
const NETWORK_INCOMPLETE: ExamTeacherErrorText = {
    zh: '考试网络配置不完整，请先指定策略和目标。',
    en: 'The exam network configuration is incomplete. Assign a policy and a target first.',
};
const POLICY_REVISION_MISSING: ExamTeacherErrorText = {
    zh: '指定的网络策略版本不存在。',
    en: 'The selected network policy revision does not exist.',
};
const TARGET_REVISION_MISSING: ExamTeacherErrorText = {
    zh: '指定的网络目标版本不存在。',
    en: 'The selected network target revision does not exist.',
};
const EMPTY_TARGET: ExamTeacherErrorText = {
    zh: '网络目标中没有终端，不能继续。',
    en: 'The network target has no endpoints.',
};
const ASSIGNMENT_REFERENCE_CHANGED: ExamTeacherErrorText = {
    zh: '座位分配引用已变化，请重新预检后再继续。',
    en: 'The seat-assignment reference has changed. Run preflight again before continuing.',
};
const CANDIDATE_SEATS_INVALID: ExamTeacherErrorText = {
    zh: '候选座位列表无效，请重新选择教室或座位。',
    en: 'The candidate seat list is invalid. Select classrooms or seats again.',
};
const CONTEST_NOT_ENTERABLE: ExamTeacherErrorText = {
    zh: '当前比赛入口不可用，学生无法进入考试工作台。',
    en: 'The contest cannot be entered, so students cannot open the exam workspace.',
};
const MONITORING_BLOCKED: ExamTeacherErrorText = {
    zh: '终端监测预检未通过，已阻止预登录。',
    en: 'Monitoring preflight failed, so pre-login was blocked.',
};
const ACTIVE_SESSION_CONFLICT: ExamTeacherErrorText = {
    zh: '终端上已有活动考试会话，无法继续预登录。',
    en: 'The endpoint already has an active exam session, so pre-login cannot continue.',
};
const PREPARATION_FINGERPRINT: ExamTeacherErrorText = {
    zh: '预登录准备指纹与当前预检不一致，请重新预检后再确认。',
    en: 'The pre-login preparation fingerprint no longer matches. Run preparation again before confirming.',
};
const RETRY_BLOCKED: ExamTeacherErrorText = {
    zh: '无法重试预登录。请查看终端预检结果后再重试失败项。',
    en: 'Pre-login retry is blocked. Review the endpoint preflight results and retry only the failed items.',
};
const RETRY_BLOCKED_PREFIX = '无法重试预登录：';
const RETRY_BLOCKED_TEMPLATE = `${RETRY_BLOCKED_PREFIX}{0}。`;
const RETRY_BLOCKED_TEMPLATE_EN = 'Pre-login retry is blocked: {0}.';
const RETRY_BLOCKED_UNKNOWN_COUNT_ZH = '其它问题';
const RETRY_BLOCKED_UNKNOWN_COUNT_EN = 'with other issues';
const RETRY_BLOCKED_REASON = 'exam_prelogin_retry_blocked';

const RETRY_BLOCKED_COUNT_LABELS: Readonly<Record<string, ExamTeacherErrorText>> = Object.freeze({
    active_session_conflict: { zh: '该终端已有活动考试会话', en: 'already have an active exam session' },
    assignment_reference_changed: { zh: '座位分配引用已变化', en: 'have a changed seat-assignment reference' },
    contest_not_enterable: { zh: '当前比赛入口不可用', en: 'cannot enter the contest' },
    endpoint_capability_missing: { zh: '终端缺少必要能力', en: 'are missing a required capability' },
    endpoint_incompatible: { zh: '终端版本或协议不兼容', en: 'are incompatible' },
    endpoint_offline: { zh: '终端离线', en: 'offline' },
    external_workspace_unavailable: { zh: '外部考试没有可用工作台', en: 'have no workspace' },
    seat_binding_changed: { zh: '座位绑定已变化', en: 'have a changed seat binding' },
    seat_facing_changed: { zh: '座位朝向已变化', en: 'have changed seat facing' },
    user_binding_changed: { zh: '学生账号绑定已变化', en: 'have a changed student binding' },
});
const ENDPOINT_OFFLINE: ExamTeacherErrorText = {
    zh: '终端当前离线，无法继续。',
    en: 'The endpoint is offline.',
};
const ENDPOINT_INCOMPATIBLE: ExamTeacherErrorText = {
    zh: '终端版本或协议不兼容，无法继续。',
    en: 'The endpoint version or protocol is incompatible.',
};
const ENDPOINT_CAPABILITY_MISSING: ExamTeacherErrorText = {
    zh: '终端缺少必要能力，无法继续。',
    en: 'The endpoint is missing a required capability.',
};
const SEAT_BINDING_CHANGED: ExamTeacherErrorText = {
    zh: '座位绑定已变化，请重新预检后再继续。',
    en: 'The seat binding has changed. Run preflight again before continuing.',
};
const USER_BINDING_CHANGED: ExamTeacherErrorText = {
    zh: '学生账号绑定已变化，请重新预检后再继续。',
    en: 'The student account binding has changed. Run preflight again before continuing.',
};
const EXTERNAL_WORKSPACE: ExamTeacherErrorText = {
    zh: '外部考试没有可用的本站考试工作台，不能预登录。',
    en: 'An external exam has no Krypton workspace, so pre-login cannot run.',
};
const SEAT_FACING_CHANGED: ExamTeacherErrorText = {
    zh: '座位朝向已变化。这不影响已发布的分配，但请确认教室朝向设置。',
    en: 'Seat facing has changed. Published assignments stay valid, but confirm classroom facing.',
};
const V2_WRITER_REQUIRED: ExamTeacherErrorText = {
    zh: '旧版写入已关闭，请使用跨教室座位计划与分配。',
    en: 'Legacy v1 writes are closed. Use the multi-classroom seat plan and assignment flow.',
};
const CONTEST_AUDIENCE_NOT_FIXED: ExamTeacherErrorText = {
    zh: '当前比赛受众不是固定名单，不能自动排座或预登录。',
    en: 'This contest audience is not a fixed roster, so automatic seating and pre-login are unavailable.',
};
const NETWORK_NOT_READY: ExamTeacherErrorText = {
    zh: '考试网络执行尚未就绪，不能开始预登录。',
    en: 'Exam network execution is not ready, so pre-login cannot start.',
};
const WORKFLOW_NOT_READY: ExamTeacherErrorText = {
    zh: '一键预登录检查未通过，请先处理网络、监测或终端硬错误。',
    en: 'One-click pre-login is not ready. Resolve network, monitoring, or endpoint hard errors first.',
};
const REQUEST_ID_CONFLICT: ExamTeacherErrorText = {
    zh: '该请求编号已用于不同内容，请使用新的请求编号。',
    en: 'This request ID was already used with different content. Use a new request ID.',
};
const ASSIGNMENT_ALREADY_CONFIRMED: ExamTeacherErrorText = {
    zh: '该座位分配已经确认过预登录，不能再创建新的批次。',
    en: 'This seat assignment already has a confirmed pre-login batch.',
};
const TICKET_EXPIRED: ExamTeacherErrorText = {
    zh: '预登录票据已过期。',
    en: 'The pre-login ticket has expired.',
};
const TICKET_REDEEMED: ExamTeacherErrorText = {
    zh: '预登录票据已被兑换。',
    en: 'The pre-login ticket has already been redeemed.',
};
const BATCH_NOT_FOUND: ExamTeacherErrorText = {
    zh: '预登录批次不存在。',
    en: 'The pre-login batch does not exist.',
};
const TICKET_NOT_FOUND: ExamTeacherErrorText = {
    zh: '预登录票据不存在。',
    en: 'The pre-login ticket does not exist.',
};
const ASSIGNMENT_NOT_FOUND: ExamTeacherErrorText = {
    zh: '座位分配不存在。',
    en: 'The seat assignment does not exist.',
};
const ASSIGNMENT_NOT_PUBLISHED: ExamTeacherErrorText = {
    zh: '座位分配尚未发布，不能预登录。',
    en: 'The seat assignment has not been published, so pre-login cannot run.',
};
const ACTIVITY_CHANGED: ExamTeacherErrorText = {
    zh: '考试预登录相关事实已变化，请重新预检后再继续。',
    en: 'Pre-login facts have changed. Run preflight again before continuing.',
};
const VIGIL_UNKNOWN: ExamTeacherErrorText = {
    zh: '无法确认 Vigil 是否收到请求，请查询当前状态后再决定是否重试。',
    en: 'It is unknown whether Vigil received the request. Check the current status before retrying.',
};
const VIGIL_REJECTED: ExamTeacherErrorText = {
    zh: 'Vigil 拒绝了本次请求。',
    en: 'Vigil rejected this request.',
};

const EXAM_TEACHER_ERROR_ENTRIES: Readonly<Record<string, ExamTeacherErrorText>> = Object.freeze({
    invalid_title: { zh: '考试标题无效。', en: 'The exam title is invalid.' },
    invalid_type: { zh: '考试类型无效。', en: 'The exam type is invalid.' },
    invalid_time_window: { zh: '考试时间窗口无效，结束时间必须晚于开始时间。', en: 'The exam time window is invalid. The end time must be after the start time.' },
    invalid_start_at: { zh: '开始时间无效。', en: 'The start time is invalid.' },
    invalid_end_at: { zh: '结束时间无效。', en: 'The end time is invalid.' },
    invalid_collaborators: { zh: '协作教师名单无效。', en: 'The collaborator list is invalid.' },
    invalid_school: { zh: '学校无效或不属于当前域。', en: 'The school is invalid or does not belong to this domain.' },
    invalid_contest: { zh: '关联比赛无效。', en: 'The linked contest is invalid.' },
    invalid_update: { zh: '更新内容无效。', en: 'The update payload is invalid.' },
    empty_update: { zh: '没有可保存的修改。', en: 'There are no changes to save.' },
    external_contest_forbidden: { zh: '外部考试不能关联本站比赛。', en: 'An external exam cannot be linked to a Krypton contest.' },
    contest_required: { zh: '计划态考试必须先关联本站比赛。', en: 'A scheduled exam must be linked to a Krypton contest.' },
    not_found: EVENT_NOT_FOUND,
    archived: EVENT_ARCHIVED,
    event_archived: EVENT_ARCHIVED,
    started: { zh: '考试活动已开始，不能再修改学校、类型、比赛或时间。', en: 'The exam has started, so school, type, contest, and time can no longer be changed.' },
    not_draft: { zh: '只有草稿状态的考试活动可以排期。', en: 'Only a draft exam event can be scheduled.' },
    start_not_future: { zh: '考试开始时间必须晚于当前时间。', en: 'The exam start time must be in the future.' },
    revision_conflict: REVISION_CONFLICT,
    assignment_publication_reference_drift: { zh: '已发布座位分配的引用已变化，请刷新后重试。', en: 'The published seat-assignment reference has drifted. Reload and try again.' },
    event_canonical_invalid: EVENT_CANONICAL_INVALID,
    event_not_found: EVENT_NOT_FOUND,
    event_school_mismatch: SCHOOL_MISMATCH,
    event_school_has_seat_facts: { zh: '考试活动已有名单或座位计划，不能更换学校。', en: 'This exam event already has roster or seat-plan facts, so the school cannot change.' },
    event_school_has_assignment_facts: { zh: '考试活动已有座位分配，不能更换学校。', en: 'This exam event already has seat-assignment facts, so the school cannot change.' },
    event_not_runnable: { zh: '当前考试活动不在可运行窗口，不能启动网络锁。', en: 'This exam event is not in a runnable window, so the network lock cannot start.' },

    candidate_seats_invalid: CANDIDATE_SEATS_INVALID,
    candidate_seat_duplicate: { zh: '候选座位存在重复项，请重新选择。', en: 'The candidate seat list contains duplicates.' },
    candidate_seat_missing: { zh: '有候选座位已不在当前教室布局中。', en: 'A candidate seat is no longer in the current classroom layout.' },
    roster_required: { zh: '必须先生成名单。', en: 'A roster must be generated first.' },
    roster_not_found: { zh: '名单不存在或引用已失效。', en: 'The roster does not exist or its reference is stale.' },
    roster_identity_mismatch: { zh: '名单与考试活动身份不一致。', en: 'The roster does not match this exam event.' },
    roster_source_changed: { zh: '名单来源已变化，请重新生成名单。', en: 'The roster source has changed. Generate the roster again.' },
    roster_revision_conflict: REVISION_CONFLICT,
    roster_school_mismatch: SCHOOL_MISMATCH,
    contest_audience_not_fixed: CONTEST_AUDIENCE_NOT_FIXED,
    contest_audience_invalid: { zh: '比赛受众无效。', en: 'The contest audience is invalid.' },
    contest_audience_cross_school: { zh: '比赛受众跨校，请拆分比赛后再创建考试活动。', en: 'The contest audience spans multiple schools. Split the contest before creating an exam event.' },
    contest_audience_unavailable: { zh: '无法读取比赛受众。', en: 'The contest audience could not be read.' },
    contest_audience_roster_required: { zh: '本站考试必须使用比赛受众名单。', en: 'A Krypton exam must use the contest-audience roster.' },
    contest_audience_userbind_missing: { zh: '比赛受众缺少对应的学生绑定。', en: 'The contest audience is missing a required student binding.' },
    contest_team_roster_not_finalized: { zh: '比赛队伍名单尚未定版。', en: 'The contest team roster has not been finalized.' },
    contest_team_roster_invalid: { zh: '比赛队伍名单无效。', en: 'The contest team roster is invalid.' },
    contest_assign_invalid: { zh: '比赛指定参赛范围无效。', en: 'The contest assignment scope is invalid.' },
    contest_assign_duplicate: DATA_DUPLICATE,
    contest_assign_group_invalid: { zh: '比赛指定用户组无效。', en: 'A contest assignment group is invalid.' },
    contest_assign_group_not_found: { zh: '比赛指定用户组不存在。', en: 'A contest assignment group was not found.' },
    contest_attendance_invalid: { zh: '比赛参赛记录无效。', en: 'Contest attendance data is invalid.' },
    contest_attendance_duplicate: DATA_DUPLICATE,
    contest_id_invalid: { zh: '比赛编号无效。', en: 'The contest ID is invalid.' },
    contest_identity_mismatch: { zh: '比赛身份与考试活动不一致。', en: 'The contest identity does not match this exam event.' },
    contest_not_enterable: CONTEST_NOT_ENTERABLE,
    classroom_school_mismatch: SCHOOL_MISMATCH,
    classroom_not_found: { zh: '教室不存在。', en: 'The classroom does not exist.' },
    seat_plan_v2_writer_required: V2_WRITER_REQUIRED,
    seat_plan_revision_conflict: REVISION_CONFLICT,
    seat_plan_classroom_missing: { zh: '座位计划引用的教室不存在。', en: 'A classroom referenced by the seat plan does not exist.' },
    seat_plan_classroom_duplicate: DATA_DUPLICATE,
    seat_plan_classrooms_invalid: { zh: '座位计划教室列表无效。', en: 'The seat-plan classroom list is invalid.' },
    seat_plan_layout_drift: { zh: '教室布局已变化，请重新生成座位计划。', en: 'The classroom layout has changed. Generate the seat plan again.' },
    seat_plan_profile_missing: { zh: '座位运行档案不存在或已变化。', en: 'The seat operational profile is missing or has changed.' },
    seat_plan_seat_missing: { zh: '座位计划中的座位已不在当前布局中。', en: 'A seat in the plan is no longer in the current layout.' },
    seat_plan_roster_missing: { zh: '座位计划引用的名单不存在或已变化。', en: 'The roster referenced by the seat plan is missing or has changed.' },
    seat_plan_not_found: { zh: '座位计划不存在。', en: 'The seat plan does not exist.' },
    seat_plan_v2_not_found: { zh: '跨教室座位计划不存在。', en: 'The multi-classroom seat plan does not exist.' },
    seat_plan_v2_not_current: { zh: '当前座位计划不是最新版本，请刷新后重试。', en: 'This seat plan is not the latest revision. Reload and try again.' },
    seat_plan_school_mismatch: SCHOOL_MISMATCH,
    userbind_roster_resolver_unavailable: { zh: '学生名单解析服务不可用。', en: 'The student-roster resolver is unavailable.' },
    userbind_student_resolver_unavailable: { zh: '学生档案服务不可用。', en: 'The student-record resolver is unavailable.' },
    userbind_group_resolver_unavailable: { zh: '用户组解析服务不可用。', en: 'The user-group resolver is unavailable.' },
    userbind_group_canonical_invalid: { zh: '用户组数据无效。', en: 'The user-group data is invalid.' },
    userbind_school_bridge_unavailable: { zh: '学校数据服务不可用。', en: 'The school directory is unavailable.' },
    'userbind school bridge is unavailable': { zh: '学校数据服务不可用。', en: 'The school directory is unavailable.' },
    'userbind student resolver is unavailable': { zh: '学生档案服务不可用。', en: 'The student-record resolver is unavailable.' },

    assignment_not_found: ASSIGNMENT_NOT_FOUND,
    assignment_v2_writer_required: V2_WRITER_REQUIRED,
    assignment_v2_not_found: { zh: '跨教室座位分配不存在。', en: 'The multi-classroom seat assignment does not exist.' },
    assignment_v2_not_current: { zh: '当前座位分配不是最新版本，请刷新后重试。', en: 'This seat assignment is not the latest revision. Reload and try again.' },
    assignment_v2_plan_required: { zh: '座位分配必须基于跨教室座位计划。', en: 'A seat assignment must be based on a multi-classroom seat plan.' },
    assignment_roster_missing: { zh: '座位分配缺少有效名单。', en: 'The seat assignment is missing a valid roster.' },
    assignment_roster_source_changed: { zh: '名单来源已变化，请重新生成座位分配。', en: 'The roster source has changed. Generate the seat assignment again.' },
    assignment_roster_plan_mismatch: { zh: '名单与座位计划不一致。', en: 'The roster does not match the seat plan.' },
    assignment_classroom_missing: { zh: '座位分配引用的教室不存在。', en: 'A classroom referenced by the assignment does not exist.' },
    layout_revision_changed: { zh: '教室布局版本已变化。', en: 'The classroom layout revision has changed.' },
    layout_fingerprint_changed: { zh: '教室布局内容已变化。', en: 'The classroom layout content has changed.' },
    seat_profile_revision_changed: { zh: '座位运行档案已变化。', en: 'The seat operational profile has changed.' },
    assignment_endpoint_duplicate: { zh: '同一终端被分配到多个座位。', en: 'The same endpoint is assigned to more than one seat.' },
    assignment_reference_changed: ASSIGNMENT_REFERENCE_CHANGED,
    assignment_reference_drift: ASSIGNMENT_REFERENCE_CHANGED,
    assignment_revision_conflict: REVISION_CONFLICT,
    assignment_publication_conflict: REVISION_CONFLICT,
    assignment_contest_identity_mismatch: { zh: '座位分配中的比赛身份不一致。', en: 'The contest identity in the seat assignment does not match.' },
    assignment_team_roster_invalid: { zh: '座位分配中的队伍名单无效。', en: 'The team roster in the seat assignment is invalid.' },
    assignment_already_confirmed: ASSIGNMENT_ALREADY_CONFIRMED,
    exam_seat_assignment_not_published: ASSIGNMENT_NOT_PUBLISHED,
    exam_seat_assignment_changed: ASSIGNMENT_REFERENCE_CHANGED,
    exam_seat_layout_changed: { zh: '考试座位布局已变化。', en: 'The exam seat layout has changed.' },

    preparation_fingerprint_mismatch: PREPARATION_FINGERPRINT,
    preparation_fingerprint_changed: PREPARATION_FINGERPRINT,
    preparation_blocked: { zh: '预登录准备存在硬错误，不能确认投递。', en: 'Pre-login preparation has hard errors and cannot be confirmed.' },
    workflow_fingerprint_changed: { zh: '预登录工作流指纹已变化，请重新预检后再确认。', en: 'The pre-login workflow fingerprint has changed. Run preflight again before confirming.' },
    workflow_not_ready: WORKFLOW_NOT_READY,
    workflow_writer_disabled: { zh: '预登录工作流写入尚未启用。', en: 'The pre-login workflow writer is not enabled.' },
    prelogin_v2_writer_disabled: { zh: '跨教室预登录写入尚未启用。', en: 'The v2 pre-login writer is not enabled.' },
    network_execution_not_ready: NETWORK_NOT_READY,
    network_execution_not_active: { zh: '考试网络执行未处于活动状态。', en: 'Exam network execution is not active.' },
    network_execution_expired: { zh: '考试网络执行已过期。', en: 'Exam network execution has expired.' },
    network_execution_changed: { zh: '考试网络执行已变化，请重新预检。', en: 'Exam network execution has changed. Run preflight again.' },
    network_execution_invalid: { zh: '考试网络执行数据无效。', en: 'Exam network execution data is invalid.' },
    network_execution_failed: { zh: '考试网络执行存在失败终端。', en: 'Exam network execution has failed endpoints.' },
    network_execution_pending: { zh: '考试网络执行尚未完成。', en: 'Exam network execution has not finished.' },
    network_target_changed: { zh: '考试网络目标已变化。', en: 'The exam network target has changed.' },
    network_window_invalid: { zh: '考试网络执行时间窗口无效。', en: 'The exam network execution window is invalid.' },
    network_configuration_incomplete: NETWORK_INCOMPLETE,
    network_configuration_exists: { zh: '该考试活动已有网络配置。', en: 'This exam event already has a network configuration.' },
    monitoring_preflight_blocked: MONITORING_BLOCKED,
    monitoring_preflight_identity_mismatch: { zh: '监测预检返回的终端身份不一致。', en: 'Monitoring preflight returned mismatched endpoint identities.' },
    request_id_conflict: REQUEST_ID_CONFLICT,
    request_id_invalid: { zh: '请求编号无效。', en: 'The request ID is invalid.' },
    batch_not_found: BATCH_NOT_FOUND,
    ticket_not_found: TICKET_NOT_FOUND,
    ticket_expired: TICKET_EXPIRED,
    ticket_already_redeemed: TICKET_REDEEMED,
    ticket_endpoint_mismatch: { zh: '预登录票据与当前终端不匹配。', en: 'The pre-login ticket does not match this endpoint.' },
    ticket_batch_mismatch: { zh: '预登录票据与批次不匹配。', en: 'The pre-login ticket does not match this batch.' },
    ticket_invalid: { zh: '预登录票据无效。', en: 'The pre-login ticket is invalid.' },
    ticket_not_redeemed: { zh: '预登录票据尚未兑换。', en: 'The pre-login ticket has not been redeemed.' },
    student_identity_missing: { zh: '预登录票据对应的学号或姓名缺失。', en: 'The pre-login ticket is missing a student ID or name.' },
    student_record_mismatch: { zh: '预登录票据与学生档案不一致。', en: 'The pre-login ticket does not match the student record.' },
    ticket_key_not_configured: { zh: '预登录票据密钥未配置。', en: 'The pre-login ticket key is not configured.' },
    ticket_key_changed_restart_required: { zh: '预登录票据密钥已变化，需要重启服务。', en: 'The pre-login ticket key changed and the service must be restarted.' },
    active_session_conflict: ACTIVE_SESSION_CONFLICT,
    endpoint_capability_missing: ENDPOINT_CAPABILITY_MISSING,
    endpoint_incompatible: ENDPOINT_INCOMPATIBLE,
    endpoint_offline: ENDPOINT_OFFLINE,
    external_workspace_unavailable: EXTERNAL_WORKSPACE,
    seat_facing_changed: SEAT_FACING_CHANGED,
    seat_binding_changed: SEAT_BINDING_CHANGED,
    user_binding_changed: USER_BINDING_CHANGED,
    exam_prelogin_retry_blocked: RETRY_BLOCKED,
    'exam_prelogin_retry_blocked:active_session_conflict': {
        zh: '无法重试预登录：终端上已有活动考试会话。',
        en: 'Pre-login retry is blocked because an endpoint already has an active exam session.',
    },
    'exam_prelogin_retry_blocked:contest_not_enterable': {
        zh: '无法重试预登录：当前比赛入口不可用。',
        en: 'Pre-login retry is blocked because the contest cannot be entered.',
    },
    'exam_prelogin_retry_blocked:assignment_reference_changed': {
        zh: '无法重试预登录：座位分配引用已变化。',
        en: 'Pre-login retry is blocked because the seat-assignment reference has changed.',
    },
    'exam_prelogin_retry_blocked:endpoint_offline': {
        zh: '无法重试预登录：有终端离线。',
        en: 'Pre-login retry is blocked because an endpoint is offline.',
    },
    'exam_prelogin_retry_blocked:endpoint_incompatible': {
        zh: '无法重试预登录：有终端版本或协议不兼容。',
        en: 'Pre-login retry is blocked because an endpoint is incompatible.',
    },
    'exam_prelogin_retry_blocked:endpoint_capability_missing': {
        zh: '无法重试预登录：有终端缺少必要能力。',
        en: 'Pre-login retry is blocked because an endpoint is missing a required capability.',
    },
    'exam_prelogin_retry_blocked:user_binding_changed': {
        zh: '无法重试预登录：学生账号绑定已变化。',
        en: 'Pre-login retry is blocked because a student binding has changed.',
    },
    'exam_prelogin_retry_blocked:seat_binding_changed': {
        zh: '无法重试预登录：座位绑定已变化。',
        en: 'Pre-login retry is blocked because a seat binding has changed.',
    },
    'exam_prelogin_retry_blocked:external_workspace_unavailable': {
        zh: '无法重试预登录：外部考试没有可用工作台。',
        en: 'Pre-login retry is blocked because the external exam has no workspace.',
    },
    'exam_prelogin_retry_blocked:seat_facing_changed': {
        zh: '无法重试预登录：座位朝向已变化。',
        en: 'Pre-login retry is blocked because seat facing has changed.',
    },
    exam_prelogin_activity_changed: ACTIVITY_CHANGED,
    exam_prelogin_assignment_not_found: ASSIGNMENT_NOT_FOUND,
    exam_prelogin_assignment_not_published: ASSIGNMENT_NOT_PUBLISHED,
    exam_prelogin_assignment_reference_changed: ASSIGNMENT_REFERENCE_CHANGED,
    exam_prelogin_dispatch_recovery_invalid: { zh: '预登录投递恢复数据无效。', en: 'Pre-login dispatch recovery data is invalid.' },
    exam_prelogin_endpoint_preflight_identity_mismatch: { zh: '预登录终端预检身份不一致。', en: 'Pre-login endpoint preflight identities do not match.' },
    exam_prelogin_resume_session_invalid: { zh: '预登录恢复会话无效。', en: 'The pre-login resume session is invalid.' },
    exam_prelogin_retry_readiness_invalid: { zh: '预登录重试就绪检查结果无效。', en: 'The pre-login retry readiness result is invalid.' },
    exam_prelogin_ticket_set_invalid: { zh: '预登录票据集合无效。', en: 'The pre-login ticket set is invalid.' },
    retry_set_invalid: { zh: '重试集合无效。', en: 'The retry set is invalid.' },
    retry_set_empty: { zh: '没有可重试的失败项。', en: 'There are no failed items to retry.' },
    retry_set_changed: { zh: '可重试集合已变化，请按当前结果重新选择。', en: 'The retryable set has changed. Select the current failed items again.' },
    retry_redeemed_ticket_expired: { zh: '已兑换票据不能按过期失败项重试。', en: 'A redeemed ticket cannot be retried as an expired failure.' },
    retry_redeemed_session_missing: { zh: '已兑换票据缺少可恢复的会话。', en: 'A redeemed ticket has no resumable session.' },

    template_not_found: { zh: '网络策略模板不存在。', en: 'The network policy template does not exist.' },
    template_archived: { zh: '网络策略模板已归档。', en: 'The network policy template is archived.' },
    target_assignment_not_found: { zh: '网络目标分配不存在。', en: 'The network target assignment does not exist.' },
    policy_revision_not_found: POLICY_REVISION_MISSING,
    target_revision_not_found: TARGET_REVISION_MISSING,
    target_revision_invalid: { zh: '网络目标版本无效。', en: 'The network target revision is invalid.' },
    empty_target: EMPTY_TARGET,
    empty_target_source: { zh: '尚未选择网络目标来源。', en: 'No network target source has been selected.' },
    duplicate_endpoint: { zh: '目标中存在重复终端。', en: 'The target contains duplicate endpoints.' },
    cross_school_endpoint: { zh: '存在不属于当前学校的终端。', en: 'The target includes an endpoint from another school.' },
    endpoint_not_owned: { zh: '终端未在当前域完成入网登记。', en: 'The endpoint is not enrolled in this domain.' },
    endpoint_not_active: { zh: '终端当前未处于活动凭据。', en: 'The endpoint does not have an active credential.' },
    endpoint_capability_incomplete: { zh: '终端网络策略能力不完整。', en: 'The endpoint network-policy capability is incomplete.' },
    endpoint_protocol_incompatible: ENDPOINT_INCOMPATIBLE,
    endpoint_preflight_invalid: { zh: '终端预检结果无效。', en: 'The endpoint preflight result is invalid.' },
    seat_binding_invalid: { zh: '座位绑定无效。', en: 'The seat binding is invalid.' },
    seat_binding_not_active: { zh: '座位绑定未激活。', en: 'The seat binding is not active.' },
    target_source_not_available: { zh: '该网络目标来源当前不可用。', en: 'This network target source is not available yet.' },
    target_confirmation_stale: { zh: '目标确认已过期，请重新预览后再发布。', en: 'The target confirmation is stale. Preview it again before publishing.' },
    confirmation_required: { zh: '发布目标前必须先确认预览指纹。', en: 'A confirmation fingerprint is required before publishing the target.' },
    target_resolver_unavailable: { zh: '网络目标解析器不可用。', en: 'The network target resolver is unavailable.' },
    control_plane_resolver_unavailable: { zh: '控制面解析器不可用。', en: 'The control-plane resolver is unavailable.' },
    invalid_name: { zh: '名称无效。', en: 'The name is invalid.' },
    invalid_revision: { zh: '版本号无效。', en: 'The revision is invalid.' },
    invalid_target_source: { zh: '网络目标来源无效。', en: 'The network target source is invalid.' },
    invalid_target_sources: { zh: '网络目标来源列表无效。', en: 'The network target source list is invalid.' },
    unexpected_fields: { zh: '请求包含不支持的字段。', en: 'The request contains unsupported fields.' },
    single_reference_required: { zh: '一次只能指定策略或目标其中一项。', en: 'Exactly one of policy or target must be specified.' },
    target_limit: { zh: '网络目标终端数量超出上限。', en: 'The network target exceeds the endpoint limit.' },
    conflicting_host_rules: { zh: '网络策略主机规则冲突。', en: 'The network policy has conflicting host rules.' },
    conflicting_ip_rules: { zh: '网络策略地址规则冲突。', en: 'The network policy has conflicting IP rules.' },
    destination_required: { zh: '网络策略至少需要一个允许的目标。', en: 'The network policy requires at least one permitted destination.' },
    invalid_control_plane: { zh: '控制面地址无效。', en: 'The control-plane address is invalid.' },
    invalid_host: { zh: '网络策略主机无效。', en: 'A network policy host is invalid.' },
    invalid_ip: { zh: '网络策略地址无效。', en: 'A network policy IP is invalid.' },
    invalid_port: { zh: '网络策略端口无效。', en: 'A network policy port is invalid.' },
    invalid_resolved_address: { zh: '解析到的控制面地址无效。', en: 'A resolved control-plane address is invalid.' },
    noncanonical_ip_network: { zh: '网络策略网段未使用规范写法。', en: 'A network policy CIDR is not in canonical form.' },
    permit_rule_limit: { zh: '网络策略规则数量超过上限。', en: 'The network policy exceeds the permit-rule limit.' },
    unresolved_control_plane: { zh: '无法解析考试控制面地址。', en: 'The exam control plane could not be resolved.' },
    unresolved_host: { zh: '网络策略中的主机无法解析。', en: 'A host in the network policy could not be resolved.' },
    control_plane_not_explicit: {
        zh: '网络策略必须显式允许 Vigil 控制面地址。只填 OJ 时学生客户端、截图和推流都会被锁死。',
        en: 'The network policy must explicitly allow the Vigil control-plane address. Allowing only the OJ host blocks the student client, screenshots, and live streams.',
    },
    control_plane_port_not_explicit: {
        zh: '已填写端口时必须包含 Vigil 控制面端口。',
        en: 'When ports are listed, the Vigil control-plane port must be included.',
    },
    stream_port_not_explicit: {
        zh: '已填写端口时必须包含录屏/摄像头推流端口 1935。',
        en: 'When ports are listed, live-stream port 1935 must be included.',
    },

    execution_not_found: { zh: '网络执行记录不存在。', en: 'The network execution does not exist.' },
    execution_not_active: { zh: '网络执行未处于活动状态。', en: 'Network execution is not active.' },
    execution_state_mismatch: { zh: '网络执行状态与请求不一致。', en: 'The network execution state does not match this request.' },
    expected_revision_required: { zh: '请提交当前期望的网络执行版本。', en: 'The expected network-execution revision is required.' },
    expected_config_revision_required: { zh: '请提交当前期望的网络配置版本。', en: 'The expected network-configuration revision is required.' },
    config_revision_conflict: { zh: '网络配置版本冲突，请刷新后重试。', en: 'The network configuration revision conflicts. Reload and try again.' },
    retry_requires_current_config: { zh: '只能重试当前配置对应的网络执行。', en: 'Retry is only allowed for the current network configuration.' },
    endpoint_retry_not_available: { zh: '没有可重试的失败终端。', en: 'There are no failed endpoints to retry.' },
    target_change_requires_stop: { zh: '更换终端目标前必须先停止并完整释放旧快照。', en: 'Stop and fully release the old target before changing endpoints.' },
    target_release_unconfirmed: { zh: '旧目标尚未确认完整释放。', en: 'The previous target has not been confirmed as fully released.' },
    network_policy_unchanged: { zh: '网络策略没有变化，无需热更新。', en: 'The network policy has not changed, so a hot update is not needed.' },
    current_request_unresolved: { zh: '上一轮网络请求尚未得到确定结果。', en: 'The previous network request has not reached a definite result.' },
    activity_window_changed: { zh: '网络活动时间窗口不能在热更新中改变。', en: 'The network activity window cannot change during a hot update.' },
    vigil_delivery_unknown: VIGIL_UNKNOWN,
    vigil_http_rejected: VIGIL_REJECTED,
    vigil_protocol_invalid: { zh: 'Vigil 协议响应无效。', en: 'The Vigil protocol response is invalid.' },
    vigil_configuration_invalid: { zh: 'Vigil 配置无效。', en: 'The Vigil configuration is invalid.' },

    'domainId is invalid': { zh: '域编号无效。', en: 'The domain ID is invalid.' },
    'eventId must be an ObjectId': { zh: '考试活动编号无效。', en: 'The exam event ID is invalid.' },
    'schoolId must be an ObjectId': { zh: '学校编号无效。', en: 'The school ID is invalid.' },
    'contestId must be an ObjectId': { zh: '比赛编号无效。', en: 'The contest ID is invalid.' },
    'contestId is invalid': { zh: '比赛编号无效。', en: 'The contest ID is invalid.' },
    'revision is invalid': { zh: '版本号无效。', en: 'The revision is invalid.' },
    'actorUid is invalid': { zh: '操作者无效。', en: 'The actor is invalid.' },
    'startAt is invalid': { zh: '开始时间无效。', en: 'The start time is invalid.' },
    'hardEndAt is invalid': { zh: '硬截止时间无效。', en: 'The hard end time is invalid.' },
    'assignmentRevision is invalid': { zh: '座位分配版本无效。', en: 'The assignment revision is invalid.' },
    'expectedRevision is invalid': { zh: '期望版本号无效。', en: 'The expected revision is invalid.' },
    'limit is invalid': { zh: '数量上限无效。', en: 'The limit is invalid.' },
    'exam prelogin facts are invalid': DATA_INVALID,
    'exam prelogin assignment fact is invalid': DATA_INVALID,
    'exam prelogin facts contain duplicate identities': DATA_DUPLICATE,
    'failed dispatch identity is invalid': DATA_INVALID,
    'unknown dispatch identity is invalid': DATA_INVALID,
    'revision reference is invalid': DATA_INVALID,
});

function parseRetryBlockedCounts(reason: string): Array<{ code: string; count: number }> | null {
    if (!reason.startsWith(`${RETRY_BLOCKED_REASON}:`)) return null;
    const rest = reason.slice(RETRY_BLOCKED_REASON.length + 1);
    const pairs = [...rest.matchAll(/([a-z][a-z0-9]*(?:_[a-z0-9]+)+)=(\d+)/g)].map(([, code, count]) => ({
        code,
        count: Number(count),
    }));
    return pairs.length ? pairs : null;
}

function formatRetryBlockedCountZh(code: string, count: number): string {
    return `${RETRY_BLOCKED_COUNT_LABELS[code]?.zh || RETRY_BLOCKED_UNKNOWN_COUNT_ZH} ${count} 台`;
}

function formatRetryBlockedCountEn(code: string, count: number): string {
    return `${count} endpoint(s) ${RETRY_BLOCKED_COUNT_LABELS[code]?.en || RETRY_BLOCKED_UNKNOWN_COUNT_EN}`;
}

function formatRetryBlockedCounts(pairs: Array<{ code: string; count: number }>): ExamTeacherErrorText {
    return {
        zh: `${RETRY_BLOCKED_PREFIX}${pairs.map(({ code, count }) => formatRetryBlockedCountZh(code, count)).join('、')}。`,
        en: `Pre-login retry is blocked: ${pairs.map(({ code, count }) => formatRetryBlockedCountEn(code, count)).join(', ')}.`,
    };
}

export function examTeacherRetryBlockedDetailZh(reason: string): string | null {
    const pairs = typeof reason === 'string' ? parseRetryBlockedCounts(reason.trim()) : null;
    if (!pairs) return null;
    return pairs.map(({ code, count }) => formatRetryBlockedCountZh(code, count)).join('、');
}

function diagnosticHead(reason: string): string {
    const separator = reason.indexOf(':');
    if (separator < 0) return reason;
    return reason.slice(0, separator);
}

function firstDiagnosticKey(reason: string): string | null {
    const separator = reason.indexOf(':');
    if (separator < 0) return null;
    const rest = reason.slice(separator + 1);
    const first = rest.split(',')[0]?.trim();
    if (!first) return null;
    const countSeparator = first.indexOf('=');
    return countSeparator < 0 ? first : first.slice(0, countSeparator);
}

function lookupEntry(reason: string): ExamTeacherErrorText | undefined {
    const exact = EXAM_TEACHER_ERROR_ENTRIES[reason];
    if (exact) return exact;
    const head = diagnosticHead(reason);
    const first = firstDiagnosticKey(reason);
    if (first) {
        const composite = EXAM_TEACHER_ERROR_ENTRIES[`${head}:${first}`];
        if (composite) return composite;
        const diagnostic = EXAM_TEACHER_ERROR_ENTRIES[first];
        if (head === 'exam_prelogin_retry_blocked' && diagnostic) return EXAM_TEACHER_ERROR_ENTRIES.exam_prelogin_retry_blocked;
        if (diagnostic && restIsLocationDetail(reason.slice(reason.indexOf(':') + 1))) return diagnostic;
    }
    if (head !== reason) {
        const prefix = EXAM_TEACHER_ERROR_ENTRIES[head];
        if (prefix) return prefix;
    }
    return undefined;
}

function restIsLocationDetail(rest: string): boolean {
    return /^(?:[A-Za-z0-9_-]+)(?::(?:[A-Fa-f0-9/._-]+|uid=\d+))*$/.test(rest);
}

function patternFallback(reason: string): ExamTeacherErrorText | undefined {
    if (/_duplicate$/.test(reason)) return DATA_DUPLICATE;
    if (/_mismatch$/.test(reason)) return DATA_MISMATCH;
    if (/_conflict$/.test(reason)) return REVISION_CONFLICT;
    if (/_changed$/.test(reason) || /_drift$/.test(reason)) return FINGERPRINT_CHANGED;
    if (/_not_found$/.test(reason) || /_missing$/.test(reason)) return NOT_FOUND;
    if (/_invalid$/.test(reason) || / is invalid$/.test(reason) || / must be an ObjectId$/.test(reason)) return DATA_INVALID;
    return undefined;
}

export function examTeacherFieldLabel(field: string): string {
    if (Object.hasOwn(EXAM_TEACHER_FIELD_LABELS, field)) {
        return EXAM_TEACHER_FIELD_LABELS[field as ExamTeacherField];
    }
    return '考试活动';
}

export function examTeacherError(reason: string): { zh: string; en: string; code?: string } {
    if (typeof reason !== 'string' || !reason.trim()) {
        return { zh: EXAM_TEACHER_UNKNOWN_ERROR_ZH, en: EXAM_TEACHER_UNKNOWN_ERROR_EN, code: reason };
    }
    const trimmed = reason.trim();
    const retryBlocked = parseRetryBlockedCounts(trimmed);
    if (retryBlocked) return formatRetryBlockedCounts(retryBlocked);
    const found = lookupEntry(trimmed) || patternFallback(trimmed);
    if (found) return { zh: found.zh, en: found.en };
    return { zh: EXAM_TEACHER_UNKNOWN_ERROR_ZH, en: EXAM_TEACHER_UNKNOWN_ERROR_EN, code: trimmed };
}

export function examTeacherErrorZh(reason: string): string {
    return examTeacherError(reason).zh;
}

export function examTeacherErrorEn(reason: string): string {
    return examTeacherError(reason).en;
}

export function examTeacherCatalogTranslations(): Readonly<Record<string, string>> {
    const translations: Record<string, string> = {
        [EXAM_TEACHER_UNKNOWN_ERROR_ZH]: EXAM_TEACHER_UNKNOWN_ERROR_EN,
        [RETRY_BLOCKED_TEMPLATE]: RETRY_BLOCKED_TEMPLATE_EN,
    };
    for (const entry of [
        ...Object.values(EXAM_TEACHER_ERROR_ENTRIES),
        DATA_INVALID,
        DATA_DUPLICATE,
        DATA_MISMATCH,
        REVISION_CONFLICT,
        FINGERPRINT_CHANGED,
        NOT_FOUND,
    ]) {
        translations[entry.zh] = entry.en;
    }
    return Object.freeze(translations);
}
