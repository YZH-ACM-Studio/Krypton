import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { PERM } from '@hydrooj/common';

// Load the new exports at runtime. A static import of a symbol this lane adds
// would fail this lane's tsc gate inside the test file before the module exists.
// This line matches @hydrooj/register's CJS strip so __filename stays defined.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

interface TeacherCapability {
    key: string;
    group: string;
    label: string;
    description: string;
    perm: bigint;
}

/** Prototype order for 「老师能做什么」, including the C6 label, copy, and bit. */
const EXPECTED: readonly TeacherCapability[] = [
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
];

const KEPT_TEACHER_BITS = [
    PERM.PERM_CREATE_PROBLEM,
    PERM.PERM_CREATE_CONTEST,
    PERM.PERM_CREATE_HOMEWORK,
    PERM.PERM_CREATE_COURSE,
    PERM.PERM_READ_RECORD_CODE,
    PERM.PERM_CREATE_EXAM_EVENT,
    PERM.PERM_CREATE_COLLECT,
    PERM.PERM_MANAGE_OWN_USER_GROUP,
] as const;

// Current teacher bundle with task creation and practice creation removed.
// Practice creation also arrives through PERM_DEFAULT, so clearing the
// explicit teacher term is not enough; the bit itself must be off.
const TEACHER_PERMISSION_WITHOUT_PRACTICE_OR_TASK = (
    PERM.PERM_DEFAULT
    | PERM.PERM_CREATE_PROBLEM
    | PERM.PERM_VIEW_PROBLEM_HIDDEN
    | PERM.PERM_VIEW_PROBLEM_BANK
    | PERM.PERM_CREATE_CONTEST
    | PERM.PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD
    | PERM.PERM_CREATE_HOMEWORK
    | PERM.PERM_VIEW_HOMEWORK_HIDDEN_SCOREBOARD
    | PERM.PERM_CREATE_COURSE
    | PERM.PERM_READ_RECORD_CODE
    | PERM.PERM_REJUDGE_PROBLEM
    | PERM.PERM_USERBIND_MANAGE_STUDENTS
    | PERM.PERM_CREATE_EXAM_EVENT
    | PERM.PERM_CREATE_REDEMPTION_CODE
    | PERM.PERM_CREATE_COLLECT
    | PERM.PERM_MANAGE_OWN_USER_GROUP
) & ~PERM.PERM_CREATE_TRAINING & ~PERM.PERM_CREATE_TASK;

function readCommonExport(name: string): unknown {
    const loaded: unknown = requireFromTest('@hydrooj/common');
    if (typeof loaded !== 'object' || loaded === null) return undefined;
    const record = loaded as Record<string, unknown>;
    if (!Object.hasOwn(record, name)) return undefined;
    return record[name];
}

function isCapability(value: unknown): value is TeacherCapability {
    if (typeof value !== 'object' || value === null) return false;
    if (!('key' in value) || typeof value.key !== 'string') return false;
    if (!('group' in value) || typeof value.group !== 'string') return false;
    if (!('label' in value) || typeof value.label !== 'string') return false;
    if (!('description' in value) || typeof value.description !== 'string') return false;
    if (!('perm' in value) || typeof value.perm !== 'bigint') return false;
    return true;
}

function singleBit(value: bigint): boolean {
    return value > 0n && (value & (value - 1n)) === 0n;
}

function capabilityIncluded(perm: bigint): boolean {
    return perm !== 0n && (PERM.PERM_TEACHER & perm) === perm;
}

describe('teacher capabilities', () => {
    it('drops task and practice creation from the teacher permission and keeps the rest', () => {
        expect(PERM.PERM_TEACHER & PERM.PERM_CREATE_TASK, 'PERM_CREATE_TASK').to.equal(0n);
        expect(PERM.PERM_TEACHER & PERM.PERM_CREATE_TRAINING, 'PERM_CREATE_TRAINING').to.equal(0n);
        expect(PERM.PERM_TEACHER, 'teacher bundle').to.equal(TEACHER_PERMISSION_WITHOUT_PRACTICE_OR_TASK);
        expect(PERM.PERM_DEFAULT & PERM.PERM_CREATE_TRAINING, 'default practice').to.equal(PERM.PERM_CREATE_TRAINING);
        expect(PERM.PERM_STUDENT & PERM.PERM_CREATE_TRAINING, 'student practice').to.equal(0n);
        expect(PERM.PERM_DEFAULT & PERM.PERM_CREATE_TASK, 'default task').to.equal(0n);
        expect(PERM.PERM_STUDENT & PERM.PERM_CREATE_TASK, 'student task').to.equal(0n);
    });

    it('still includes the listed teacher authoring permissions', () => {
        for (const bit of KEPT_TEACHER_BITS) {
            expect(PERM.PERM_TEACHER & bit).to.equal(bit);
        }
    });

    it('lists fourteen capabilities in prototype order with distinct keys', () => {
        const raw = readCommonExport('TEACHER_CAPABILITIES');
        expect(Array.isArray(raw), 'TEACHER_CAPABILITIES').to.equal(true);
        if (!Array.isArray(raw)) return;
        expect(raw.length).to.equal(EXPECTED.length);
        for (const [index, expected] of EXPECTED.entries()) {
            const item: unknown = raw[index];
            expect(isCapability(item), expected.key).to.equal(true);
            if (!isCapability(item)) return;
            expect(item.key).to.equal(expected.key);
            expect(item.group).to.equal(expected.group);
            expect(item.label).to.equal(expected.label);
            expect(item.description).to.equal(expected.description);
            expect(item.perm).to.equal(expected.perm);
        }
        expect(new Set(raw.map((item) => (isCapability(item) ? item.key : ''))).size).to.equal(EXPECTED.length);
    });

    it('builds the mask from fourteen single-bit permissions', () => {
        const rawItems = readCommonExport('TEACHER_CAPABILITIES');
        const rawMask = readCommonExport('TEACHER_CAPABILITY_MASK');
        expect(Array.isArray(rawItems), 'TEACHER_CAPABILITIES').to.equal(true);
        expect(typeof rawMask, 'TEACHER_CAPABILITY_MASK').to.equal('bigint');
        if (!Array.isArray(rawItems) || typeof rawMask !== 'bigint') return;
        expect(rawItems.length).to.equal(EXPECTED.length);
        let combined = 0n;
        for (const item of rawItems) {
            expect(isCapability(item), 'capability').to.equal(true);
            if (!isCapability(item)) return;
            expect(singleBit(item.perm), item.key).to.equal(true);
            combined |= item.perm;
        }
        expect(rawMask).to.equal(combined);
    });

    it('keeps only practice and task creation outside the teacher permission', () => {
        const raw = readCommonExport('TEACHER_CAPABILITIES');
        expect(Array.isArray(raw), 'TEACHER_CAPABILITIES').to.equal(true);
        if (!Array.isArray(raw)) return;
        const off: string[] = [];
        const on: string[] = [];
        for (const item of raw) {
            expect(isCapability(item), 'capability').to.equal(true);
            if (!isCapability(item)) return;
            if (capabilityIncluded(item.perm)) on.push(item.key);
            else off.push(item.key);
        }
        expect(off).to.deep.equal(['createPractice', 'createTask']);
        expect(on).to.deep.equal([
            'createProblem',
            'browseProblemBank',
            'viewHiddenProblem',
            'createHomework',
            'createContest',
            'createCourse',
            'manageOwnGroups',
            'manageStudents',
            'readRecordCode',
            'createCollect',
            'createRedemptionCode',
            'createExamEvent',
        ]);
    });
});
