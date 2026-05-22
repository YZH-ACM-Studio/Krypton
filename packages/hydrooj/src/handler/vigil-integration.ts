/**
 * Vigil ↔ OJ HTTP integration — OJ side.
 *
 * All `/api/vigil/*` endpoints require `X-Service-Token` matching the Vigil
 * accepted-tokens list. `/api/admin/vigil/dashboard-token` is the only
 * route consumed by the OJ admin (a logged-in human, not Vigil) — it issues
 * a short-lived Vigil dashboard token bound to the OJ admin's session.
 *
 * Phase 3 wires this to:
 *   - userBindModel.lookupStudent (Phase 1)
 *   - UserModel.create (temporary user creation)
 *   - vigil-bridge.verifyAccessTokenWithVigil (outbound)
 */
import { randomBytes } from 'node:crypto';
import { ObjectId } from 'mongodb';
import {
    Context, Handler, NotFoundError, OplogModel, param, PRIV, Types,
    ValidationError, UserModel, requireServiceToken,
} from 'hydrooj';
import * as contestModel from '../model/contest';
import * as document from '../model/document';
import system from '../model/system';

class VigilApiHandler extends Handler {
    noCheckPermView = true;
    async prepare() {
        requireServiceToken(this, 'vigil');
    }
}

// ─── POST /api/vigil/lookup-student ───────────────────────────────────────

class VigilLookupStudentHandler extends VigilApiHandler {
    @param('domainId', Types.String)
    @param('studentId', Types.String)
    @param('realName', Types.String)
    async post(
        { }, domainId: string, studentId: string, realName: string,
    ) {
        const userbind = (global as any).Hydro?.model?.userbind;
        if (!userbind?.lookupStudent) {
            this.response.body = { found: false, eligibleExams: [], reason: 'userbind_not_loaded' };
            return;
        }
        const result = await userbind.lookupStudent(domainId, studentId, realName);

        // Hydrate eligibleContestIds → full exam payload (with all the fields Vigil
        // wants for the OjContest cache).
        let eligibleExams: any[] = [];
        if (result.found && result.eligibleContestIds.length > 0) {
            const contestColl = (global as any).Hydro?.service?.db?.collection?.('document');
            if (contestColl) {
                const tdocs = await contestColl
                    .find({ docId: { $in: result.eligibleContestIds }, rule: 'exam' })
                    .toArray();
                eligibleExams = tdocs.map((t: any) => ({
                    ojContestId: t.docId.toString(),
                    ojDomainId: t.domainId,
                    title: t.title,
                    beginAt: t.beginAt,
                    endAt: t.endAt,
                    approvalMode: t.approvalMode || 'strict',
                    lockdownMode: !!t.lockdownMode,
                    pauseOnDisconnect: !!t.pauseOnDisconnect,
                    screenshotIntervalMs: t.screenshotIntervalMs || 60000,
                    exclusive: !!t.exclusive,
                }));
            }
        }
        this.response.body = {
            found: result.found,
            ojUserId: result.userId,
            eligibleExams,
            reason: result.reason,
        };
    }
}

// ─── POST /api/vigil/notify-session-opened ────────────────────────────────

class VigilNotifySessionOpenedHandler extends VigilApiHandler {
    @param('sessionId', Types.String)
    @param('ojUserId', Types.Int)
    @param('tid', Types.String)
    @param('machineId', Types.String)
    async post({ }, sessionId: string, ojUserId: number, tid: string, machineId: string) {
        await OplogModel.log(this as any, 'vigil.session_opened', {
            sessionId, ojUserId, tid, machineId,
        });
        // Persist last-seen machine id on the user doc for convenience.
        try {
            await UserModel.coll.updateOne(
                { _id: ojUserId },
                { $set: { vigilLastSeenMachineId: machineId, vigilLastSessionAt: new Date() } as any },
            );
        } catch (e) { /* best-effort */ }
        this.response.body = { ok: true };
    }
}

// ─── POST /api/vigil/notify-session-closed ────────────────────────────────

class VigilNotifySessionClosedHandler extends VigilApiHandler {
    @param('sessionId', Types.String)
    @param('closeReason', Types.String, true)
    async post({ }, sessionId: string, closeReason?: string) {
        await OplogModel.log(this as any, 'vigil.session_closed', { sessionId, closeReason });
        this.response.body = { ok: true };
    }
}

// ─── POST /api/vigil/exchange-access-token ────────────────────────────────

/**
 * Webview-side endpoint: page opens with `?session=...&token=...`, then JS
 * POSTs here to convert the opaque token into a real OJ session cookie.
 *
 * Validation: we forward to Vigil server which is the issuer of the token.
 * If Vigil confirms validity, we set a cookie session for the OJ user the
 * token was issued for.
 */
class VigilExchangeAccessTokenHandler extends Handler {
    noCheckPermView = true;

    @param('sessionId', Types.String)
    @param('accessToken', Types.String)
    async post({ }, sessionId: string, accessToken: string) {
        const { verifyAccessTokenWithVigil } = await import('../service/vigil-bridge');
        const result = await verifyAccessTokenWithVigil(sessionId, accessToken);
        if (!result.valid || !result.ojUserId) {
            this.response.status = 401;
            this.response.body = { error: 'invalid token' };
            return;
        }
        // Set the user session.
        this.session.uid = result.ojUserId;
        this.session.sessionId = randomBytes(16).toString('hex');
        this.session.examSessionId = sessionId;
        this.session.examContestId = result.ojContestId;
        this.response.body = {
            ok: true,
            redirect: result.ojContestId ? `/exam-mode/${result.ojContestId}` : '/exam-mode',
        };
    }
}

// ─── POST /api/vigil/temporary-user ───────────────────────────────────────

/**
 * Create an `isTemporary` OJ user for a proctor-approved unknown student.
 * No password; returns a one-shot access token for immediate webview launch.
 *
 * The temporary user persists post-exam (records preserved for audit) but is
 * disabled (priv=0) after the contest ends. PRD §3.6 covers claim/recovery.
 */
class VigilTemporaryUserHandler extends VigilApiHandler {
    @param('studentIdInput', Types.String)
    @param('realNameInput', Types.String)
    @param('machineId', Types.String)
    @param('tid', Types.String)
    @param('approvedByOjUserId', Types.Int)
    async post(
        { }, studentIdInput: string, realNameInput: string, machineId: string,
        tid: string, approvedByOjUserId: number,
    ) {
        const tempSuffix = randomBytes(3).toString('hex');
        const username = `temp_${tid.slice(-8)}_${tempSuffix}`;
        const email = `${username}@temp.krypton.local`;
        const password = randomBytes(32).toString('hex'); // unguessable; user can't log in via password anyway
        const ip = (this.request as any).ip || '0.0.0.0';

        const uid = await UserModel.create(email, username, password, undefined, ip, PRIV.PRIV_USER_PROFILE);
        // Mark as temporary; record the studentId/realName for audit and later claim.
        await UserModel.coll.updateOne({ _id: uid }, {
            $set: {
                isTemporary: true,
                tempStudentIdInput: studentIdInput,
                tempRealNameInput: realNameInput,
                tempMachineId: machineId,
                tempContestId: tid,
                tempApprovedBy: approvedByOjUserId,
                displayName: `[临时] ${realNameInput}`,
            } as any,
        });
        await OplogModel.log(this as any, 'vigil.temporary_user_created', {
            tempUid: uid, studentIdInput, realNameInput, tid, approvedByOjUserId,
        });

        const oneTimeToken = `t_oneshot_${randomBytes(24).toString('hex')}`;
        // Store the one-time token in system settings keyed by token id — it's a
        // short-lived bearer that gets consumed by `exchange-access-token` flow.
        // (Stored briefly; cleanup via TTL or manual purge.)
        await system.set(`vigil.oneshot.${oneTimeToken}`, JSON.stringify({
            uid, contestId: tid, expiresAt: Date.now() + 3600_000,
        }));

        this.response.body = { tempUserId: uid, oneTimeToken };
    }
}

// ─── GET /api/admin/vigil/dashboard-token ─────────────────────────────────

/**
 * Issue a short-lived Vigil dashboard token to the current OJ admin.
 * The token is what ui-next's `/admin/vigil/*` pages use to call Vigil.
 *
 * We don't actually mint a Vigil-side token here — instead we return one of
 * the configured `KVS_DASHBOARD_TOKEN` values (admin would normally hand-share
 * this; this endpoint is convenience). Production deployments would invoke a
 * Vigil-side mint endpoint here.
 */
class VigilDashboardTokenHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }

    async get() {
        const token = system.get('vigil.dashboardToken') || '';
        const vigilBaseUrl = system.get('vigil.baseUrl') || '';
        const vigilWsUrl = (vigilBaseUrl.replace(/^http/, 'ws')) + '/api/ws/dashboard';
        this.response.body = {
            token,
            vigilBaseUrl,
            vigilWsUrl,
            expiresAt: Date.now() + 3600_000, // hint — actual TTL is Vigil-side
        };
    }
}

// ─── POST /api/vigil/force-finalize ──────────────────────────────────────

/**
 * Server-to-server hook invoked by Vigil's proctor force_submit command. We
 * look up the contest + user, then drive the same draft-fanout-finalize path
 * as the regular student finalize endpoint — but bypassing the student auth
 * + contest time-window checks (this is privileged path).
 */
class VigilForceFinalizeHandler extends VigilApiHandler {
    @param('sessionId', Types.String)
    @param('ojUserId', Types.Int)
    @param('ojContestId', Types.String)
    async post({ }, sessionId: string, ojUserId: number, ojContestId: string) {
        const tid = new ObjectId(ojContestId);
        const PaperDraftModel = (global as any).Hydro?.model?.paper_draft
            || (await import('../model/paper-draft')).default;
        const contestModel = await import('../model/contest');
        const recordModel = await import('../model/record');
        const yaml = await import('js-yaml');

        // We don't know which OJ domain — pull it from the contest doc.
        const tdoc: any = await (global as any).Hydro?.service?.db
            ?.collection('document')
            ?.findOne?.({ docId: tid, docType: 30 /* TYPE_CONTEST */ });
        if (!tdoc) {
            this.response.status = 404;
            this.response.body = { error: 'contest not found' };
            return;
        }
        const domainId = tdoc.domainId;

        const drafts = await PaperDraftModel.getDraftsForUser(domainId, tid, ojUserId);
        const pdocs: Record<number, any> = {};
        await Promise.all((tdoc.pids || []).map(async (pid: number) => {
            const pdoc = await (await import('../model/problem')).default.get(domainId, pid);
            if (pdoc) pdocs[pid] = pdoc;
        }));

        const rids: ObjectId[] = [];
        for (const draft of drafts) {
            const pdoc = pdocs[draft.pid];
            if (!pdoc) continue;
            const config = typeof pdoc.config === 'object' ? pdoc.config : null;
            const type = config?.type || 'default';
            if (type === 'objective') {
                const yamlBody = yaml.default.dump(draft.answers || {});
                rids.push(await recordModel.add(domainId, draft.pid, ojUserId, '_', yamlBody, true,
                    { contest: tid, type: 'judge', meta: { proctorForced: true, sessionId } } as any));
            } else if (type === 'fill_function') {
                const codeBody = draft.code || JSON.stringify(draft.answers || {});
                const lang = draft.lang || config?.template?.lang || 'cpp';
                rids.push(await recordModel.add(domainId, draft.pid, ojUserId, lang, codeBody, true,
                    { contest: tid, type: 'judge', meta: { proctorForced: true, sessionId } } as any));
            } else if (type === 'default' && draft.code) {
                const lang = draft.lang || config?.langs?.[0] || 'cpp';
                rids.push(await recordModel.add(domainId, draft.pid, ojUserId, lang, draft.code, true,
                    { contest: tid, type: 'judge', meta: { proctorForced: true, sessionId } } as any));
            } else if (type === 'submit_answer') {
                rids.push(await recordModel.add(domainId, draft.pid, ojUserId, '_', draft.code || '', true,
                    { contest: tid, type: 'judge', meta: { proctorForced: true, sessionId } } as any));
            }
        }

        for (const rid of rids) {
            await contestModel.updateStatus(domainId, tid, ojUserId, rid, 0);
        }

        // Close the session via the outbound bridge.
        const { closeSessionOnVigil } = await import('../service/vigil-bridge');
        await closeSessionOnVigil(ojContestId, sessionId, 'force_finalize');

        this.response.body = { ok: true, rids, count: rids.length };
    }
}

// ─── Admin dashboard shell handlers ──────────────────────────────────────

class VigilAdminOverviewHandler extends Handler {
    async prepare() { this.checkPriv(PRIV.PRIV_EDIT_SYSTEM); }
    async get() {
        this.response.template = 'admin_vigil_overview.html';
        this.response.body = {};
    }
}

// Exam-scoped detail handler — all sub-views (sessions / approvals / events
// / overview) for one Hydro contest. The React page reads :examId and
// filters client-side.
class VigilAdminExamDetailHandler extends Handler {
    async prepare() { this.checkPriv(PRIV.PRIV_EDIT_SYSTEM); }
    async get({ domainId, examId }: { domainId: string; examId: string }) {
        let examTitle: string | null = null;
        if (ObjectId.isValid(examId)) {
            try {
                const tdoc = await contestModel.get(domainId, new ObjectId(examId));
                if (tdoc?.title) examTitle = tdoc.title;
            } catch { /* not found → leave null, React falls back to id */ }
        }
        this.response.template = 'admin_vigil_exam_detail.html';
        this.response.body = { examId, examTitle };
    }
}

/**
 * Bulk resolve Hydro contest titles for a list of contest ids. Used by the
 * vigil overview React page to render readable names on the exam cards /
 * ended table instead of bare ObjectId hex strings.
 *
 *   POST /api/admin/vigil/resolve-contests { ids: ["507f1f...", ...] }
 *   →   { "507f1f...": "期末考试 A", "608a2b...": "周赛 #12", ... }
 *
 * Unknown / malformed ids are silently dropped from the response so the
 * caller can treat the map as "best effort" and fall back to the id.
 */
class VigilResolveContestsHandler extends Handler {
    async prepare() { this.checkPriv(PRIV.PRIV_EDIT_SYSTEM); }

    @param('ids', Types.CommaSeperatedArray, true)
    async post({ domainId }: { domainId: string }, ids: string[] = []) {
        const validIds = (ids || [])
            .map((s) => String(s).trim())
            .filter((s) => ObjectId.isValid(s))
            .map((s) => new ObjectId(s));
        const map: Record<string, string> = {};
        if (validIds.length) {
            // Hydro contests are stored in the `document` collection with the
            // contest's tid living in `docId`, not `_id`. We don't filter
            // by `domainId` here on purpose — the vigil dashboard is a
            // system-wide admin view and the proctored exam may live in any
            // domain. Caller already gated to PRIV_EDIT_SYSTEM.
            const tdocs = await document.coll.find({
                docType: document.TYPE_CONTEST,
                docId: { $in: validIds },
            }).project({ docId: 1, title: 1 }).toArray();
            for (const tdoc of tdocs) {
                if (tdoc.docId && tdoc.title) map[String(tdoc.docId)] = tdoc.title;
            }
        }
        this.response.body = map;
    }
}

// ─── Route registration ───────────────────────────────────────────────────

export async function apply(ctx: Context) {
    ctx.Route('admin_vigil_overview', '/admin/vigil', VigilAdminOverviewHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('admin_vigil_exam_detail', '/admin/vigil/exams/:examId', VigilAdminExamDetailHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('admin_vigil_resolve_contests', '/api/admin/vigil/resolve-contests', VigilResolveContestsHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('vigil_lookup_student', '/api/vigil/lookup-student', VigilLookupStudentHandler);
    ctx.Route('vigil_notify_session_opened', '/api/vigil/notify-session-opened', VigilNotifySessionOpenedHandler);
    ctx.Route('vigil_notify_session_closed', '/api/vigil/notify-session-closed', VigilNotifySessionClosedHandler);
    ctx.Route('vigil_exchange_access_token', '/api/vigil/exchange-access-token', VigilExchangeAccessTokenHandler);
    ctx.Route('vigil_temporary_user', '/api/vigil/temporary-user', VigilTemporaryUserHandler);
    ctx.Route('vigil_force_finalize', '/api/vigil/force-finalize', VigilForceFinalizeHandler);
    ctx.Route('vigil_dashboard_token', '/api/admin/vigil/dashboard-token', VigilDashboardTokenHandler, PRIV.PRIV_EDIT_SYSTEM);
}
