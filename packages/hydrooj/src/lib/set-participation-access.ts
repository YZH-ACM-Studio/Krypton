import { readStoredSetConfig } from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import type { ObjectId } from 'mongodb';
import { ContestClientFinishedError, ContestNotFoundError, localizedErrorText, PermissionError, ValidationError } from '../error';
import type { Tdoc } from '../interface';
import { PERM, PRIV } from '../model/builtin';
import * as contest from '../model/contest';
import { assertHomeworkAccess } from '../model/homework-access';
import type { Handler } from '../service/server';
import { decideContainerVisibility } from './container-visibility';
import { assertCourseExamWatchGate } from './course-exam-gate';
import { allowsPostContestView } from './contest-correction';
import { assertSetCapability } from './set-permissions';

const logger = new Logger('set-access');

interface ClientGate {
    clientSessionKeyFromSession(session: unknown): string;
    isValidClientSessionForContest(key: string, domainId: string, tid: ObjectId, uid: number): Promise<boolean>;
}

/** Title-only drafts stay editable; their student workspace needs an explicit time window. */
export function assertSetPreviewWindow(tdoc: Tdoc, manager: boolean) {
    if (!manager || tdoc.setConfig === undefined) return;
    if (readStoredSetConfig(tdoc).publication !== 'draft') return;
    if (tdoc.beginAt == null || tdoc.endAt == null) {
        throw new ValidationError('beginAt', null, localizedErrorText`请先设置开放时间，再预览学生作答页面。`);
    }
}

/** Every formal-round route has the same entry checks as the original submission routes. */
export async function assertSetParticipation(handler: Pick<Handler, 'domain' | 'user' | 'session'>, tdoc: Tdoc, writing: boolean, allowClientOnlyView = false, starting = false) {
    const config = readStoredSetConfig(tdoc);
    const domainId = handler.domain._id;
    const uid = handler.user._id;
    if (tdoc.domainId !== domainId) throw new ContestNotFoundError(domainId, tdoc.docId);
    const manager = handler.user.own(tdoc) || handler.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)
        || handler.user.hasPerm(config.purpose === 'homework' ? PERM.PERM_EDIT_HOMEWORK : PERM.PERM_EDIT_CONTEST);
    contest.requirePublishedForStudent(tdoc, manager);
    if (!writing) assertSetPreviewWindow(tdoc, manager);
    if (config.publication !== 'published' && (writing || !manager)) throw new ValidationError('round', null, localizedErrorText`请先发布题目集。`);
    if (writing && manager) throw new ValidationError('round', null, localizedErrorText`请使用验题预览，管理者不能在预览中创建正式作答。`);
    if (!writing && !manager && !allowClientOnlyView && Date.now() >= tdoc.endAt.getTime() && !allowsPostContestView(tdoc)) {
        throw new ContestNotFoundError(domainId, tdoc.docId);
    }
    await decideContainerVisibility(domainId, tdoc, handler.user);
    await assertSetCapability(tdoc, handler.user, writing ? starting ? 'view' : 'answer' : 'selfRecords');
    const status = await contest.getStatus(domainId, tdoc.docId, uid);
    const guard = (global.Hydro.model as unknown as { vigilguard?: ClientGate }).vigilguard;
    const sessionKey = guard?.clientSessionKeyFromSession(handler.session) ?? '';
    const needsClient = !manager && contest.isClientRequired(tdoc) && (writing || Date.now() < tdoc.endAt.getTime());
    const hasClient = !!sessionKey && !!guard
        && await guard.isValidClientSessionForContest(sessionKey, domainId, tdoc.docId, uid);
    const perm = config.purpose === 'homework' ? PERM.PERM_ATTEND_HOMEWORK : PERM.PERM_ATTEND_CONTEST;
    const clientOnlyView = needsClient && !hasClient && !writing && allowClientOnlyView;
    if ((!manager && !handler.user.hasPerm(perm) && !hasClient) || (needsClient && !hasClient && !clientOnlyView)) {
        logger.info('round access denied domain=%s tid=%s uid=%d reason=%s', domainId, tdoc.docId, uid, needsClient ? 'client_required' : 'attend_permission');
        throw new PermissionError(perm);
    }
    if (needsClient && contest.isClientFinished(status)) throw new ContestClientFinishedError();
    if (!manager) {
        if (config.purpose === 'homework') await assertHomeworkAccess(domainId, tdoc, handler.user);
        else {
            if (tdoc.assign?.length && !tdoc.assign.some((group) => handler.user.group.includes(group))) {
                throw new ContestNotFoundError(domainId, tdoc.docId);
            }
            if (!await contest.studentRecordHitsContestScope(domainId, uid, tdoc)) {
                logger.info('round access denied domain=%s tid=%s uid=%d reason=participant_scope', domainId, tdoc.docId, uid);
                throw new ContestNotFoundError(domainId, tdoc.docId);
            }
        }
        if (writing && tdoc._code && !status?.attend) {
            throw new ValidationError('attend', null, localizedErrorText`请先在题目集入口使用邀请码参加。`);
        }
    }
    await assertCourseExamWatchGate({ domainId, user: handler.user, contest: tdoc });
    return { status, sessionKey, hasClient, clientOnlyView };
}
