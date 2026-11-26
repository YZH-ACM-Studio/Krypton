import { parseRapidPassRule, type RapidPassRule } from '@hydrooj/common';
import { ObjectId } from 'mongodb';
import { Context } from '../context';
import { localizedErrorText, NotFoundError, PermissionError, ValidationError } from '../error';
import type { Tdoc } from '../interface';
import { TYPE_CONTEST } from '../model/document';
import { withContestEditBoundary } from '../lib/contest-edit-boundary';
import { assertTeachManage } from '../lib/teach-access';
import { loadLegacyRapidPassEvidence, loadRapidPassEvidence, loadRapidPassPolicy, writeRapidPassPolicy } from '../lib/teach-rapid-pass';
import { logger } from '../logger';
import { PERM, PRIV } from '../model/builtin';
import db from '../service/db';
import { Handler, param, Types } from '../service/server';

class TeachRapidPassHandler extends Handler {
    async authorize(domainId: string, type: string, tid: ObjectId) {
        if (type !== 'homework' && type !== 'exam') throw new NotFoundError();
        const doc = await assertTeachManage(domainId, this.user, type, tid);
        const purpose = doc.setConfig?.purpose ?? doc.rule;
        if (doc.docType !== TYPE_CONTEST || doc.participationMode === 'team' || (purpose !== 'homework' && purpose !== 'exam')) throw new NotFoundError();
        if (!this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) && !this.user.hasPerm(PERM.PERM_USERBIND_MANAGE_STUDENTS)) {
            throw new PermissionError(PERM.PERM_USERBIND_MANAGE_STUDENTS);
        }
        return doc;
    }

    async respond(domainId: string, doc: Tdoc) {
        const policy = await loadRapidPassPolicy(db, domainId, doc.docId);
        const signals = doc.setConfig
            ? await loadRapidPassEvidence(db, domainId, doc.docId, policy.rule)
            : await loadLegacyRapidPassEvidence(db, domainId, doc, TYPE_CONTEST, policy.rule);
        this.response.template = null;
        this.response.body = { ...policy, signals };
    }

    @param('type', Types.String)
    @param('id', Types.ObjectId)
    async get(_args: unknown, type: string, tid: ObjectId) {
        const domainId = this.domain._id;
        const doc = await this.authorize(domainId, type, tid);
        await this.respond(domainId, doc);
    }

    @param('type', Types.String)
    @param('id', Types.ObjectId)
    async post(_args: unknown, type: string, tid: ObjectId) {
        const domainId = this.domain._id;
        const doc = await withContestEditBoundary(domainId, tid, async () => {
            const current = await this.authorize(domainId, type, tid);
            const body = this.request.body;
            const revision = body?.revision;
            if (!Number.isSafeInteger(revision) || revision < 0) throw new ValidationError('revision');
            let rule: RapidPassRule;
            try {
                rule = parseRapidPassRule(body.rule);
            } catch (error) {
                if (!(error instanceof TypeError)) throw error;
                throw new ValidationError('rule', null, localizedErrorText`请填写有效的分析时间窗口和题数。`);
            }
            if (!await writeRapidPassPolicy(db, domainId, tid, rule, revision)) {
                throw new ValidationError('revision', null, localizedErrorText`分析设置已更新，请重新读取。`);
            }
            logger.info('teach rapid pass policy domain=%s tid=%s actor=%d revision=%d enabled=%s minutes=%d minProblems=%d',
                domainId, tid.toHexString(), this.user._id, revision + 1, rule.enabled, rule.minutes, rule.minProblems);
            return current;
        });
        await this.respond(domainId, doc);
    }
}

export function apply(ctx: Context) {
    ctx.Route('teach_rapid_pass', '/teach/:type/:id/rapid-passes', TeachRapidPassHandler, PRIV.PRIV_USER_PROFILE);
    ctx.on('contest/del', async (domainId, tid) => {
        await db.collection<{ _id: { domainId: string; tid: ObjectId } }>('contest.rapidPassPolicies').deleteOne({ _id: { domainId, tid } });
    });
}
