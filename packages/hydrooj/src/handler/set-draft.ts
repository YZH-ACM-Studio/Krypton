import { ObjectId } from 'mongodb';
import {
    assertSetCreateAllowed,
    isContestPurpose,
    setConfigMessage,
    setLifecycleMessage,
    SET_CREATE_TEXT,
    teachTypeOfContestRule,
    type SetPurpose,
    type TeachType,
} from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import { ContestNotFoundError, LocalizedErrorText, ValidationError } from '../error';
import type { TeachActor } from '../lib/teach-access';
import { canReadTeachCopy, loadUsableDocIds } from '../lib/teach-copy';
import { copiedDraftUpdate, selectCopiedDraftFields } from '../lib/set-publication';
import { PERM, PRIV } from '../model/builtin';
import * as contest from '../model/contest';
import { Handler } from '../service/server';

const logger = new Logger('set-draft');

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function teacherText(error: unknown): string | null {
    if (!(error instanceof TypeError)) return null;
    if (error.message === 'set_title_invalid') return setLifecycleMessage(error.message);
    if (error.message === 'set_publish_state_invalid') return SET_CREATE_TEXT.set_publish_state_invalid.zh;
    try {
        return setConfigMessage(error.message);
    } catch {
        return null;
    }
}

function chineseError(message: string): LocalizedErrorText {
    const strings = [message] as unknown as TemplateStringsArray;
    Object.defineProperty(strings, 'raw', { value: [message] });
    return new LocalizedErrorText(strings, []);
}

function rejectConfig(error: unknown): never {
    const text = teacherText(error);
    if (text) throw new ValidationError('set', null, chineseError(text));
    throw error;
}

function actorOf(handler: Handler): TeachActor {
    const actor = handler.user as TeachActor | undefined;
    if (!actor || typeof actor._id !== 'number' || typeof actor.hasPerm !== 'function' || typeof actor.hasPriv !== 'function' || typeof actor.own !== 'function') {
        throw new ValidationError('user', null, chineseError('用户无效。'));
    }
    return actor;
}

function sourceTeachType(rule: unknown): TeachType {
    if (rule === 'contest') return 'exam';
    try {
        return teachTypeOfContestRule(rule);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'teach_rule_unsupported') {
            throw new ValidationError('sourceId', null, chineseError('要复制的题目集不存在。'));
        }
        throw error;
    }
}

function missingSource(): never {
    throw new ValidationError('sourceId', null, chineseError('要复制的题目集不存在。'));
}

function targetTeachType(kind: SetPurpose): TeachType {
    return kind === 'contest' ? 'exam' : kind;
}

class SetDraftCreateHandler extends Handler {
    async post(raw: unknown) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        if (!isRecord(raw)) throw new ValidationError('query', null, chineseError('请求参数无效。'));
        const domainId = this.domain?._id;
        if (typeof domainId !== 'string' || !domainId) throw new ValidationError('domainId', null, chineseError('域无效。'));
        let kind;
        try {
            kind = assertSetCreateAllowed(
                {
                    privEditSystem: this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
                    createHomework: this.user.hasPerm(PERM.PERM_CREATE_HOMEWORK),
                    createExam: this.user.hasPerm(PERM.PERM_CREATE_CONTEST),
                    createPractice: this.user.hasPerm(PERM.PERM_CREATE_TRAINING),
                },
                raw.kind,
            );
        } catch (error) {
            rejectConfig(error);
        }
        if (!isContestPurpose(kind)) {
            throw new ValidationError('kind', null, chineseError('练习仍从练习入口创建。'));
        }
        const sourceId = raw.sourceId;
        if (sourceId !== undefined) {
            if (typeof sourceId !== 'string' || !/^[0-9a-f]{24}$/i.test(sourceId)) {
                throw new ValidationError('sourceId', null, chineseError('要复制的题目集不存在。'));
            }
            const sourceObjectId = new ObjectId(sourceId);
            let source;
            try {
                source = await contest.get(domainId, sourceObjectId);
            } catch (error) {
                if (error instanceof ContestNotFoundError) missingSource();
                throw error;
            }
            if (!source) missingSource();
            const actor = actorOf(this);
            const sourceType = sourceTeachType(source.rule);
            if (!canReadTeachCopy(actor, sourceType, source)) missingSource();
            let copied: ReturnType<typeof copiedDraftUpdate>;
            try {
                copied = copiedDraftUpdate(source, kind);
            } catch (error) {
                if (error instanceof TypeError && error.message === 'set_copy_purpose_mismatch') {
                    throw new ValidationError('kind', null, chineseError('不能把这种题目集复制成所选类型。'));
                }
                if (error instanceof TypeError && error.message === 'set_copy_score_invalid') {
                    throw new ValidationError('score', null, chineseError('题目分值无法复制。'));
                }
                rejectConfig(error);
            }
            const usable = await loadUsableDocIds(domainId, actor, copied.pids);
            const unusable = new Set<number>(copied.pids.filter((pid) => !usable.has(pid)));
            if (typeof source.title !== 'string' || typeof source.owner !== 'number') missingSource();
            const statement = typeof raw.statement === 'string'
                ? raw.statement.trim()
                : (typeof source.content === 'string' ? source.content : '');
            let fields;
            try {
                fields = selectCopiedDraftFields({
                    pids: copied.pids,
                    score: copied.score,
                    unusable,
                    statement,
                    sourceType,
                    sourceId: sourceObjectId,
                    sourceTitle: source.title,
                    ownerUid: source.owner,
                    copiedBy: actor._id,
                    copiedAt: new Date(),
                });
            } catch (error) {
                rejectConfig(error);
            }
            if (targetTeachType(kind) !== sourceType && kind !== 'contest') missingSource();
            let docId;
            try {
                docId = await contest.addDraft(domainId, this.user._id, kind, raw.title);
            } catch (error) {
                rejectConfig(error);
            }
            await contest.edit(domainId, docId, {
                pids: fields.pids,
                setConfig: copied.setConfig,
                ...(source.setPoints ? { setPoints: Object.fromEntries(fields.pids.map((pid) => [pid, source.setPoints[pid]])) } : {}),
                ...(source.setTargetScore != null ? { setTargetScore: source.setTargetScore } : {}),
                content: fields.content,
                copiedFrom: fields.copiedFrom,
                ...(fields.score ? { score: fields.score } : {}),
            });
            logger.info('problem set copied as draft domain=%s tid=%s source=%s', domainId, String(docId), sourceId);
            this.response.body = { id: String(docId), kind };
            return;
        }
        let docId;
        try {
            docId = await contest.addDraft(domainId, this.user._id, kind, raw.title);
        } catch (error) {
            rejectConfig(error);
        }
        this.response.body = { id: String(docId), kind };
    }
}

export async function apply(ctx: { Route: (name: string, path: string, HandlerClass: typeof Handler, priv?: number) => void }) {
    ctx.Route('set_draft_create', '/teach/draft', SetDraftCreateHandler, PRIV.PRIV_USER_PROFILE);
}
