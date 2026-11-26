import { PERM } from './permission';

export type TeacherCapabilityKey =
    | 'createProblem'
    | 'browseProblemBank'
    | 'viewHiddenProblem'
    | 'createHomework'
    | 'createContest'
    | 'createPractice'
    | 'createCourse'
    | 'manageOwnGroups'
    | 'manageStudents'
    | 'readRecordCode'
    | 'createTask'
    | 'createCollect'
    | 'createRedemptionCode'
    | 'createExamEvent';

export interface TeacherCapability {
    key: TeacherCapabilityKey;
    group: '题目' | '题目集' | '课程与学生' | '其它';
    label: string;
    description: string;
    perm: bigint;
}

/** Order is the 「老师能做什么」 page. */
export const TEACHER_CAPABILITIES: readonly TeacherCapability[] = Object.freeze([
    {
        key: 'createProblem',
        group: '题目',
        label: '出题',
        description: '创建自己的题目，编辑自己名下的题',
        perm: PERM.PERM_CREATE_PROBLEM,
    },
    {
        key: 'browseProblemBank',
        group: '题目',
        label: '浏览题库',
        description: '打开题库并在组卷时选题',
        perm: PERM.PERM_VIEW_PROBLEM_BANK,
    },
    {
        key: 'viewHiddenProblem',
        group: '题目',
        label: '看隐藏题',
        description: '看到未公开的题面（组卷用）',
        perm: PERM.PERM_VIEW_PROBLEM_HIDDEN,
    },
    {
        key: 'createHomework',
        group: '题目集',
        label: '布置作业',
        description: '新建作业，给自己的用户组布置',
        perm: PERM.PERM_CREATE_HOMEWORK,
    },
    {
        key: 'createContest',
        group: '题目集',
        label: '建考试和比赛',
        description: '新建试卷考试、ACM、OI·IOI',
        perm: PERM.PERM_CREATE_CONTEST,
    },
    {
        key: 'createPractice',
        group: '题目集',
        label: '建练习',
        description: '新建练习类题目集',
        perm: PERM.PERM_CREATE_TRAINING,
    },
    {
        key: 'createCourse',
        group: '课程与学生',
        label: '建课程',
        description: '新建课程并维护章节、视频',
        perm: PERM.PERM_CREATE_COURSE,
    },
    {
        key: 'manageOwnGroups',
        group: '课程与学生',
        label: '管理自己的用户组',
        description: '建组、加减组员、批量粘贴学号姓名',
        perm: PERM.PERM_MANAGE_OWN_USER_GROUP,
    },
    {
        key: 'manageStudents',
        group: '课程与学生',
        label: '管理学生档案',
        description: '新建和删除自己建的学生记录',
        perm: PERM.PERM_USERBIND_MANAGE_STUDENTS,
    },
    {
        key: 'readRecordCode',
        group: '课程与学生',
        label: '看提交代码',
        description: '打开学生提交的代码（本域全部提交）',
        perm: PERM.PERM_READ_RECORD_CODE,
    },
    {
        key: 'createTask',
        group: '其它',
        label: '建任务',
        description: '在任务中心发布任务',
        perm: PERM.PERM_CREATE_TASK,
    },
    {
        key: 'createCollect',
        group: '其它',
        label: '建文件收集',
        description: '向自己的用户组收文件',
        perm: PERM.PERM_CREATE_COLLECT,
    },
    {
        key: 'createRedemptionCode',
        group: '其它',
        label: '建兑换码',
        description: '为自己的题目集发兑换码',
        perm: PERM.PERM_CREATE_REDEMPTION_CODE,
    },
    {
        key: 'createExamEvent',
        group: '其它',
        label: '建机房考试场次',
        description: '给自己的考试排机房与座位',
        perm: PERM.PERM_CREATE_EXAM_EVENT,
    },
]);

export const TEACHER_CAPABILITY_MASK: bigint = TEACHER_CAPABILITIES.reduce(
    (mask, item) => mask | item.perm,
    0n,
);
