import { ObjectId } from 'mongodb';
import { localizedErrorText, PermissionError, ValidationError } from '../error';
import type { User } from '../interface';
import { isCourseKind, isProblemSetKind } from '../lib/training-kind';
import { PERM, PRIV, STATUS } from './builtin';
import { problemSetAccessService } from './problem-set-access';
import type { PracticeContainerKind, PracticeContextMode, PracticeScopeKind } from './practice-integrity';
import problem from './problem';
import * as training from './training';

interface PracticeAccessHandler {
    ctx: { parallel(name: string, document: unknown, handler: unknown): Promise<unknown> };
}

export interface PracticeAccessTarget {
    containerKind: PracticeContainerKind;
    containerId: ObjectId;
    scopeKind: PracticeScopeKind;
    scopeId: number;
}

export function canPreviewPracticeIntegrity(user: User, pdoc: any, canManageContainer = false): boolean {
    if (canManageContainer || user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return true;
    if (problem.canMaintainProblem(user, pdoc) || problem.canAuthorProblem(user, pdoc)) return true;
    return (user as User & { _permitPids?: Set<number> })._permitPids?.has(Number(pdoc?.docId)) === true;
}

export function assertPracticeContainerKind(tdoc: any, containerKind: PracticeContainerKind): void {
    const matches = containerKind === 'course' ? isCourseKind(tdoc?.kind) : isProblemSetKind(tdoc?.kind);
    if (!matches) throw new ValidationError('containerKind', null, localizedErrorText`真实性训练容器类型不匹配`);
}

export function canManagePracticeContainer(user: User, tdoc: any, containerKind: PracticeContainerKind): boolean {
    if (user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return true;
    if (containerKind === 'course') return user.own(tdoc) || user.hasPerm(PERM.PERM_EDIT_COURSE);
    return user.hasPerm(PERM.PERM_EDIT_TRAINING) || (user.own(tdoc) && user.hasPerm(PERM.PERM_EDIT_TRAINING_SELF));
}

export function requiredPracticeManagePermission(user: User, tdoc: any, containerKind: PracticeContainerKind) {
    if (containerKind === 'course') return PERM.PERM_EDIT_COURSE;
    return user.own(tdoc) ? PERM.PERM_EDIT_TRAINING_SELF : PERM.PERM_EDIT_TRAINING;
}

export async function loadPracticeContainer(domainId: string, containerKind: PracticeContainerKind, containerId: ObjectId) {
    const tdoc = await training.get(domainId, containerId);
    if (!tdoc || String(tdoc.docId) !== containerId.toHexString()) {
        throw new ValidationError('containerId', null, localizedErrorText`真实性训练容器不存在`);
    }
    assertPracticeContainerKind(tdoc, containerKind);
    return tdoc;
}

async function completedProblemSetNodeIds(domainId: string, uid: number, tdoc: any): Promise<Set<number>> {
    const integrity = global.Hydro?.model?.practiceIntegrity?.practiceIntegrityService;
    const completions = global.Hydro?.model?.contextualCompletion?.contextualCompletionService;
    if (typeof integrity?.getLatestPublished === 'function' && typeof completions?.getCompletedByScope === 'function') {
        const published = await integrity.getLatestPublished(domainId, 'problemSet', tdoc.docId);
        if (published) {
            const scoped = await completions.getCompletedByScope(domainId, uid, 'problemSet', tdoc.docId);
            return new Set(training.buildScopedTrainingProgress(tdoc, scoped).doneNids);
        }
    }
    const pids = training.getPids(tdoc.dag || []);
    const psdict = await problem.getListStatus(domainId, uid, pids);
    const donePids = new Set<number>();
    for (const [pid, psdoc] of Object.entries(psdict || {})) {
        if ((psdoc as { status?: number } | undefined)?.status === STATUS.STATUS_ACCEPTED) donePids.add(+pid);
    }
    const doneNids = new Set<number>();
    for (const node of tdoc.dag || []) {
        if (training.isDone(node, doneNids, donePids)) doneNids.add(node._id);
    }
    return doneNids;
}

async function assertCourseVisible(domainId: string, user: User, tdoc: any, canManage: boolean): Promise<void> {
    if (canManage || !(tdoc.courseGroupIds || []).length) return;
    const findStudent = global.Hydro?.model?.userbind?.findStudentByUserId;
    if (typeof findStudent !== 'function') throw new TypeError('userbind.findStudentByUserId is unavailable');
    const student = await findStudent(domainId, user._id);
    const groups = new Set((student?.groupIds || []).map((groupId: ObjectId) => String(groupId)));
    if (!(tdoc.courseGroupIds || []).some((groupId: ObjectId) => groups.has(String(groupId)))) {
        throw new PermissionError(PERM.PERM_VIEW_TRAINING);
    }
}

export async function assertPracticeTargetAccess(input: {
    domainId: string;
    user: User;
    handler: PracticeAccessHandler;
    target: PracticeAccessTarget;
    pid: number;
    mode: PracticeContextMode;
    checkProblem?: boolean;
    setRejectionReason?: (reason: string) => void;
}) {
    const { domainId, user, handler, target, pid, mode } = input;
    const expectedScopeKind: PracticeScopeKind = target.containerKind === 'course' ? 'chapter' : 'stage';
    input.setRejectionReason?.('scope-container-mismatch');
    if (target.scopeKind !== expectedScopeKind) {
        throw new ValidationError('scopeKind', null, localizedErrorText`真实性训练范围与容器不匹配`);
    }
    input.setRejectionReason?.('container-unavailable');
    const tdoc = await loadPracticeContainer(domainId, target.containerKind, target.containerId);
    const canManage = canManagePracticeContainer(user, tdoc, target.containerKind);
    input.setRejectionReason?.('container-view-denied');
    if (!user.hasPerm(PERM.PERM_VIEW_TRAINING) && !canManage) throw new PermissionError(PERM.PERM_VIEW_TRAINING);
    if (target.containerKind === 'problemSet' && !canManage) {
        input.setRejectionReason?.('problem-set-access-denied');
        await problemSetAccessService.assertAccessible(domainId, user, tdoc);
        input.setRejectionReason?.('problem-set-stage-denied');
        await problemSetAccessService.assertStageEnterable(
            domainId,
            user,
            tdoc,
            target.scopeId,
            await completedProblemSetNodeIds(domainId, user._id, tdoc),
        );
    }
    input.setRejectionReason?.('container-extension-denied');
    if (target.containerKind === 'problemSet') await handler.ctx.parallel('training/get', tdoc, handler);
    input.setRejectionReason?.('course-group-denied');
    if (target.containerKind === 'course') await assertCourseVisible(domainId, user, tdoc, canManage);
    if (input.checkProblem !== false) {
        input.setRejectionReason?.('problem-view-denied');
        const visibleProblem = await problem.getViewableAuthorized(domainId, pid, user);
        if (!visibleProblem) throw new PermissionError(PERM.PERM_VIEW_PROBLEM);
        input.setRejectionReason?.('preview-denied');
        if (mode === 'preview' && !canPreviewPracticeIntegrity(user, visibleProblem, canManage)) {
            throw new PermissionError(requiredPracticeManagePermission(user, tdoc, target.containerKind));
        }
    } else if (mode === 'preview' && !canManage) {
        input.setRejectionReason?.('preview-denied');
        throw new PermissionError(requiredPracticeManagePermission(user, tdoc, target.containerKind));
    }
    input.setRejectionReason?.('pid-outside-scope');
    const scope = (tdoc.dag || []).find((node: any) => Number(node._id) === target.scopeId);
    if (!scope || !(scope.pids || []).map(Number).includes(pid)) {
        throw new ValidationError('pid', null, localizedErrorText`题目不属于请求的真实性训练范围`);
    }
    return tdoc;
}

export async function assertPracticeContextAccess(input: {
    domainId: string;
    user: User;
    handler: PracticeAccessHandler;
    targets: readonly PracticeAccessTarget[];
    pid: number;
    mode: PracticeContextMode;
    setRejectionReason?: (reason: string) => void;
}): Promise<void> {
    input.setRejectionReason?.('context-no-targets');
    if (!input.targets.length) throw new ValidationError('contextId', null, localizedErrorText`真实性训练上下文没有完成目标`);
    for (let index = 0; index < input.targets.length; index++) {
        await assertPracticeTargetAccess({
            ...input,
            target: input.targets[index],
            checkProblem: index === 0,
            setRejectionReason: input.setRejectionReason,
        });
    }
}
