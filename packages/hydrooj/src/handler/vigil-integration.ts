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
    Context, Handler, OplogModel, param, PRIV, Types,
    UserModel, requireServiceToken,
} from 'hydrooj';
import * as contestModel from '../model/contest';
import * as document from '../model/document';
import system from '../model/system';
import db from '../service/db';

function parseStringList(value: any): string[] {
    if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
    return String(value || '')
        .split(/[\s,;]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function vigilMediaFields(tdoc: any) {
    const processWhitelist = Array.from(new Set([
        ...parseStringList(system.get('vigil.processWhitelistGlobal')),
        ...parseStringList(tdoc?.vigilProcessWhitelist || []),
    ]));
    return {
        liveEnabled: tdoc?.liveEnabled !== false,
        recordEnabled: !!tdoc?.recordEnabled,
        cameraEnabled: tdoc?.cameraEnabled !== false,
        screenshotJitterMs: tdoc?.screenshotJitterMs ?? 30000,
        processWhitelist,
    };
}

function clientSessionKeyFromHydroSession(session: any): string {
    return session?.sessionId || session?._id || session?.sid || '';
}

async function persistVigilClientSession(handler: Handler, result: any, vigilSessionId: string) {
    const sidValue = clientSessionKeyFromHydroSession((handler as any).session);
    if (!sidValue || !result?.ojContestId) return;
    const clientSessionsColl = (db as any).collection('vigil.client_sessions');
    const now = new Date();
    const contestId = new ObjectId(result.ojContestId);
    await clientSessionsColl.deleteMany({
        sid: sidValue,
        vigilSessionId: { $ne: vigilSessionId },
    });
    await clientSessionsColl.updateOne(
        { vigilSessionId },
        {
            $set: {
                sid: sidValue,
                vigilSessionId,
                domainId: result.ojDomainId || 'system',
                contestId,
                uid: result.ojUserId,
                machineId: result.machineId || '',
                isTemporary: !!result.isTemporary,
                scopeOverride: !!result.scopeOverride,
                updatedAt: now,
                // Expire 12h from now — generous upper bound for multi-day
                // events; Vigil close hooks and the TTL sweep handle earlier
                // teardown.
                expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
            },
            $setOnInsert: {
                createdAt: now,
            },
        },
        { upsert: true },
    );
}

async function ensureVigilContestParticipation(domainId: string, contestId: string | undefined, uid: number) {
    if (!contestId || !ObjectId.isValid(contestId) || !uid) return;
    const tid = new ObjectId(contestId);
    const tdoc = await contestModel.get(domainId, tid);
    if (!tdoc) return;

    let tsdoc = await contestModel.getStatus(domainId, tid, uid);
    if (!tsdoc?.attend && !contestModel.isDone(tdoc, tsdoc)) {
        try {
            await contestModel.attend(domainId, tid, uid, { subscribe: 1 });
        } catch (e) {
            tsdoc = await contestModel.getStatus(domainId, tid, uid);
            if (!tsdoc?.attend) throw e;
        }
        tsdoc = await contestModel.getStatus(domainId, tid, uid);
    }
    if (tsdoc?.attend && !tsdoc.startAt && contestModel.isOngoing(tdoc, tsdoc)) {
        await contestModel.setStatus(domainId, tid, uid, { startAt: new Date() });
    }
}

async function deleteLocalClientSession(vigilSessionId: string) {
    if (!vigilSessionId) return 0;
    const res = await (db as any).collection('vigil.client_sessions').deleteOne({ vigilSessionId });
    return res.deletedCount || 0;
}

async function verifyVigilParticipantScope(
    domainId: string, contestId: string | undefined, uid: number, scopeOverride = false,
): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!contestId) return { ok: true };
    if (!ObjectId.isValid(contestId)) {
        return { ok: false, message: 'Vigil 返回的比赛 ID 无效，请联系考务重新发起登录。' };
    }
    let tdoc: any = null;
    try {
        tdoc = await contestModel.get(domainId, new ObjectId(contestId));
    } catch {
        return { ok: false, message: '该比赛不存在或已被删除，请联系考务确认考试设置。' };
    }
    const vg = (global as any).Hydro?.model?.vigilguard;
    if (vg?.hitsParticipantScope) {
        const scopeOk = await vg.hitsParticipantScope(domainId, tdoc, uid);
        if (!scopeOk && !scopeOverride) {
            return { ok: false, message: '你不在当前比赛允许的学校或用户组范围内。' };
        }
    }
    return { ok: true };
}

async function checkVigilStudentFinished(
    domainId: string, contestId: string | undefined, uid: number,
): Promise<{ finished: false } | { finished: true; message: string }> {
    if (!contestId || !ObjectId.isValid(contestId) || !uid) return { finished: false };
    const tid = new ObjectId(contestId);
    const [tdoc, tsdoc] = await Promise.all([
        contestModel.get(domainId, tid).catch(() => null),
        contestModel.getStatus(domainId, tid, uid).catch(() => null),
    ]);
    if (!tdoc || !contestModel.isClientRequired(tdoc) || !contestModel.isClientFinished(tsdoc)) {
        return { finished: false };
    }
    return {
        finished: true,
        message: '你已在客户端主动结束本场比赛/考试，不能再次进入。请联系监考老师重置主动结束状态。',
    };
}

async function verifyStudentFinishIdentity(
    _domainId: string,
    _uid: number,
    studentIdInput: string,
    realNameInput: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
    // Active finish is a misfire guard, not an authority check. The
    // authoritative identity verification happens at login / approval time,
    // where the proctor has already vetted the student. By that point three
    // layers re-verify identity and they must share one baseline — the
    // login-time snapshot the student typed:
    //   - Qt Client (exam_shell.cpp) compares lastStudentId_/lastRealName_.
    //   - Vigil Server (routes.py _verify_finish_identity) compares
    //     ExamSession.extra.studentIdInput/realNameInput.
    // OJ used to compare the userbind/OJ profile instead, so a login name
    // with a stray space or variant character (which login/approval already
    // accepted) would be rejected here. We now align OJ with the other two:
    // this is a service-token-only internal call and Vigil has already
    // checked the login snapshot, so OJ only requires non-empty inputs.
    const gotStudentId = String(studentIdInput || '').trim();
    const gotRealName = String(realNameInput || '').trim();
    if (!gotStudentId || !gotRealName) return { ok: false, message: '请填写学号和姓名确认结束。' };
    return { ok: true };
}

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
    @param('contestId', Types.String, true)
    @param('ojContestId', Types.String, true)
    @param('tid', Types.String, true)
    async post(
        _args: any, domainId: string, studentId: string, realName: string,
        contestId?: string, ojContestId?: string, tid?: string,
    ) {
        const userbind = (global as any).Hydro?.model?.userbind;
        if (!userbind?.lookupStudent) {
            this.response.body = {
                found: false, eligibleContests: [], reason: 'userbind_not_loaded',
            };
            return;
        }
        const result = await userbind.lookupStudent(domainId, studentId, realName, {
            contestId: contestId || ojContestId || tid,
        });

        // Hydrate eligibleContestIds → full contest payload (all rules, with
        // the fields Vigil wants for the OjContest cache).
        //
        // Field name change (vs v1): `eligibleExams` → `eligibleContests`.
        // The shape change reflects the design's pivot from exam-only to
        // any-rule client-required contests (DESIGN §5.1). Each entry now
        // includes the `rule` so the Qt Client can render different
        // workspace templates (paper for `exam`; scoreboard for `acm`).
        let eligibleContests: any[] = [];
        if (result.found && result.eligibleContestIds.length > 0) {
            const tdocs = await db.collection('document')
                .find({ docId: { $in: result.eligibleContestIds } })
                .toArray();
            eligibleContests = tdocs
                // Only contests that opted into Vigil (or are legacy
                // exam contests, which the v1 vigilguard migration
                // back-fills to vigilEnabled=true).
                .filter((t: any) => t.vigilEnabled === true)
                .map((t: any) => ({
                    ojContestId: t.docId.toString(),
                    ojDomainId: t.domainId,
                    title: t.title,
                    rule: t.rule,
                    entryMode: t.entryMode || 'open',
                    beginAt: t.beginAt,
                    endAt: t.endAt,
                    approvalMode: t.approvalMode || 'strict',
                    lockdownMode: !!t.lockdownMode,
                    networkLockdownMode: !!t.networkLockdownMode,
                    networkLockdownFailurePolicy: t.networkLockdownFailurePolicy || (t.networkLockdownMode ? 'strict' : 'off'),
                    networkWhitelistHosts: t.networkWhitelistHosts || [],
                    networkWhitelistIps: t.networkWhitelistIps || [],
                    networkWhitelistPorts: t.networkWhitelistPorts || [],
                    pauseOnDisconnect: !!t.pauseOnDisconnect,
                    screenshotIntervalMs: t.screenshotIntervalMs || 60000,
                    exclusive: !!t.exclusive,
                    clientLoginBlockBeforeMinutes: t.clientLoginBlockBeforeMinutes ?? 60,
                    clientLoginBlockAfterMinutes: t.clientLoginBlockAfterMinutes ?? 30,
                    ...vigilMediaFields(t),
                }));
        }
        this.response.body = {
            found: result.found,
            ojUserId: result.userId,
            matchedDomainId: result.domainId,
            eligibleContests,
            // Back-compat alias for Vigil servers pinned to the v1 API
            // shape. Will be removed once Vigil server is updated.
            eligibleExams: eligibleContests,
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
    async post(_args: any, sessionId: string, ojUserId: number, tid: string, machineId: string) {
        await OplogModel.log(this as any, 'vigil.session_opened', {
            sessionId, ojUserId, tid, machineId,
        });
        // Persist last-seen machine id on the user doc for convenience.
        try {
            await UserModel.coll.updateOne(
                { _id: ojUserId },
                { $set: { vigilLastSeenMachineId: machineId, vigilLastSessionAt: new Date() } as any },
            );
        } catch { /* best-effort */ }
        this.response.body = { ok: true };
    }
}

// ─── POST /api/vigil/notify-session-closed ────────────────────────────────

class VigilNotifySessionClosedHandler extends VigilApiHandler {
    @param('sessionId', Types.String)
    @param('closeReason', Types.String, true)
    async post(_args: any, sessionId: string, closeReason?: string) {
        const deletedLocalClientSessions = await deleteLocalClientSession(sessionId);
        await OplogModel.log(this as any, 'vigil.session_closed', {
            sessionId, closeReason, deletedLocalClientSessions,
        });
        this.response.body = { ok: true };
    }
}

// ─── POST /api/vigil/student-finish ──────────────────────────────────────

class VigilStudentFinishHandler extends VigilApiHandler {
    @param('sessionId', Types.String)
    @param('ojUserId', Types.Int)
    @param('ojContestId', Types.String)
    @param('closeReason', Types.String, true)
    @param('machineId', Types.String, true)
    @param('studentIdInput', Types.String, true)
    @param('realNameInput', Types.String, true)
    async post(
        _args: any,
        sessionId: string,
        ojUserId: number,
        ojContestId: string,
        closeReason = 'student_exit',
        machineId = '',
        studentIdInput = '',
        realNameInput = '',
    ) {
        if (!ObjectId.isValid(ojContestId)) {
            this.response.status = 400;
            this.response.body = { error: 'invalid_contest_id' };
            return;
        }
        const tid = new ObjectId(ojContestId);
        const tdoc: any = await contestModel.get('system', tid).catch(() => null)
            || await db.collection('document').findOne({ docType: document.TYPE_CONTEST, docId: tid });
        if (!tdoc) {
            this.response.status = 404;
            this.response.body = { error: 'contest_not_found' };
            return;
        }
        const domainId = tdoc.domainId || 'system';
        const identity = await verifyStudentFinishIdentity(domainId, ojUserId, studentIdInput, realNameInput);
        if (!identity.ok) {
            const failedIdentity = identity as { ok: false, message: string };
            this.response.status = 403;
            this.response.body = { error: 'identity_mismatch', message: failedIdentity.message };
            return;
        }

        const before = await contestModel.getStatus(domainId, tid, ojUserId);
        const alreadyFinished = contestModel.isClientFinished(before);
        let rids: ObjectId[] = [];
        if (!alreadyFinished && tdoc.rule === 'exam') {
            const { finalizePaperForUser } = await import('./paper');
            rids = await finalizePaperForUser(domainId, tid, ojUserId, {
                tdoc,
                meta: {
                    clientFinished: true,
                    sessionId,
                    closeReason,
                },
            });
        }

        await contestModel.markClientFinished(domainId, tid, ojUserId, {
            reason: closeReason || (tdoc.rule === 'exam' ? 'student_submit' : 'student_exit'),
            sessionId,
            machineId,
            studentIdInput,
            realNameInput,
        });
        const deletedLocalClientSessions = await deleteLocalClientSession(sessionId);
        await OplogModel.log(this as any, 'vigil.student_finish', {
            sessionId,
            ojUserId,
            ojContestId,
            closeReason,
            machineId,
            finalizedRecords: rids.length,
            alreadyFinished,
            deletedLocalClientSessions,
        });
        this.response.body = {
            ok: true,
            alreadyFinished,
            rids,
            count: rids.length,
            rule: tdoc.rule,
            deletedLocalClientSessions,
        };
    }
}

// ─── POST /api/vigil/reset-student-finish ────────────────────────────────

class VigilResetStudentFinishHandler extends VigilApiHandler {
    @param('sessionId', Types.String, true)
    @param('ojUserId', Types.Int)
    @param('ojContestId', Types.String)
    @param('proctorOjUserId', Types.Int, true)
    async post(_args: any, sessionId: string | undefined, ojUserId: number, ojContestId: string, proctorOjUserId?: number) {
        if (!ObjectId.isValid(ojContestId)) {
            this.response.status = 400;
            this.response.body = { error: 'invalid_contest_id' };
            return;
        }
        const tid = new ObjectId(ojContestId);
        const tdoc: any = await db.collection('document')
            .findOne({ docType: document.TYPE_CONTEST, docId: tid });
        if (!tdoc) {
            this.response.status = 404;
            this.response.body = { error: 'contest_not_found' };
            return;
        }
        await contestModel.clearClientFinished(tdoc.domainId || 'system', tid, ojUserId);
        await OplogModel.log(this as any, 'vigil.student_finish_reset', {
            sessionId,
            ojUserId,
            ojContestId,
            proctorOjUserId,
        });
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
    async post(_args: any, sessionId: string, accessToken: string) {
        const { verifyAccessTokenWithVigil } = require('../service/vigil-bridge');
        const result = await verifyAccessTokenWithVigil(sessionId, accessToken);
        if (!result.valid || !result.ojUserId) {
            this.response.status = 401;
            this.response.body = { error: 'invalid token' };
            return;
        }
        const scopeCheck = await verifyVigilParticipantScope(
            result.ojDomainId || 'system',
            result.ojContestId,
            result.ojUserId,
            !!result.scopeOverride,
        );
        if (!scopeCheck.ok) {
            const message = (scopeCheck as { ok: false; message: string }).message;
            this.response.status = 403;
            this.response.body = { error: 'scope_miss', message };
            await OplogModel.log(this as any, 'vigilguard.scope_miss', {
                sessionId,
                ojContestId: result.ojContestId,
                uid: result.ojUserId,
                message,
            });
            return;
        }
        const finishedCheck = await checkVigilStudentFinished(
            result.ojDomainId || 'system',
            result.ojContestId,
            result.ojUserId,
        );
        if (finishedCheck.finished) {
            this.response.status = 403;
            this.response.body = { error: 'student_finished', message: finishedCheck.message };
            return;
        }
        try {
            await ensureVigilContestParticipation(
                result.ojDomainId || 'system',
                result.ojContestId,
                result.ojUserId,
            );
        } catch (e: any) {
            this.response.status = 500;
            this.response.body = {
                error: 'contest_attend_failed',
                message: '客户端认证已通过，但 OJ 自动参加比赛失败，请联系考务。',
            };
            await OplogModel.log(this as any, 'vigilguard.attend_fail', {
                sessionId,
                ojContestId: result.ojContestId,
                uid: result.ojUserId,
                error: e?.message || String(e),
            });
            return;
        }
        // Set the user session.
        this.session.uid = result.ojUserId;
        this.session.sessionId = randomBytes(16).toString('hex');
        this.session.examSessionId = sessionId;
        this.session.examContestId = result.ojContestId;
        try {
            await persistVigilClientSession(this, result, sessionId);
        } catch (e: any) {
            await OplogModel.log(this as any, 'vigilguard.write_fail', {
                sessionId,
                ojContestId: result.ojContestId,
                error: e?.message || String(e),
            });
        }
        this.response.body = {
            ok: true,
            redirect: result.ojContestId ? `/exam-mode/${result.ojContestId}` : '/exam-mode',
        };
    }
}

// ─── GET /vigil-launch ────────────────────────────────────────────────────

/**
 * Public landing page for the Qt Client's webview after Vigil approval.
 * The client navigates to `/vigil-launch?session=...&token=...` with
 * the credentials the Vigil server issued at approval time. We verify the
 * token with Vigil, mint an OJ session cookie, then 302 to the real
 * `/exam-mode/{tid}` page.
 *
 * This route is intentionally public (no `PRIV_USER_PROFILE` gate) — the
 * whole point is to bootstrap an authenticated session for a Qt Client
 * that has no prior OJ cookie. The opaque vigil-issued token is the auth.
 *
 * On any failure (token expired, sessionId unknown, Vigil unreachable) we
 * render a minimal HTML error page rather than Hydro's full-chrome error
 * template — exam clients are running under stress and a clean
 * standalone page is friendlier than a busy nav-bar layout.
 */
class VigilExamModeLaunchHandler extends Handler {
    noCheckPermView = true;

    @param('session', Types.String)
    @param('token', Types.String)
    async get(_args: any, sessionId: string, accessToken: string) {
        const renderError = (title: string, message: string, status = 401) => {
            this.response.status = status;
            this.response.body = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Krypton</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; }
  body { margin:0; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    background:#0f172a; color:#e2e8f0; min-height:100vh; display:flex; align-items:center;
    justify-content:center; padding:2rem; }
  main { max-width: 480px; text-align:center; }
  h1 { font-size:1.5rem; margin:0 0 1rem; color:#f87171; }
  p { line-height:1.6; color:#cbd5e1; }
</style></head>
<body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
            this.response.type = 'text/html';
        };

        if (!sessionId || !accessToken) {
            renderError('链接无效', '该启动链接缺少 session 或 token 参数。请联系考务。');
            return;
        }
        let result: any;
        try {
            const { verifyAccessTokenWithVigil } = require('../service/vigil-bridge');
            result = await verifyAccessTokenWithVigil(sessionId, accessToken);
        } catch (e: any) {
            renderError('无法验证会话', `Vigil 服务无法连接：${e?.message || e}。请联系考务。`);
            return;
        }
        if (!result?.valid || !result.ojUserId) {
            renderError('会话已过期或无效', '此考试启动链接已失效。请联系考务重新发起登录。');
            return;
        }
        const scopeCheck = await verifyVigilParticipantScope(
            result.ojDomainId || 'system',
            result.ojContestId,
            result.ojUserId,
            !!result.scopeOverride,
        );
        if (!scopeCheck.ok) {
            const message = (scopeCheck as { ok: false; message: string }).message;
            await OplogModel.log(this as any, 'vigilguard.scope_miss', {
                sessionId,
                ojContestId: result.ojContestId,
                uid: result.ojUserId,
                message,
            });
            renderError('无权进入比赛', message, 403);
            return;
        }
        const finishedCheck = await checkVigilStudentFinished(
            result.ojDomainId || 'system',
            result.ojContestId,
            result.ojUserId,
        );
        if (finishedCheck.finished) {
            renderError('已主动结束', finishedCheck.message, 403);
            return;
        }

        try {
            await ensureVigilContestParticipation(
                result.ojDomainId || 'system',
                result.ojContestId,
                result.ojUserId,
            );
        } catch (e: any) {
            await OplogModel.log(this as any, 'vigilguard.attend_fail', {
                sessionId,
                ojContestId: result.ojContestId,
                uid: result.ojUserId,
                error: e?.message || String(e),
            });
            renderError('无法参加比赛', '客户端认证已通过，但 OJ 自动参加比赛失败。请联系考务。', 500);
            return;
        }

        // Bootstrap an OJ session for the user the token was issued for.
        this.session.uid = result.ojUserId;
        this.session.sessionId = randomBytes(16).toString('hex');
        this.session.examSessionId = sessionId;
        this.session.examContestId = result.ojContestId;

        // Persist the Vigil↔OJ binding to `vigil.client_sessions`. This is
        // what the request-layer lockout middleware and the contest-detail
        // access gate read to decide "does this sid have a client session
        // for this contest?". Single-contest binding per DESIGN §8.1.
        //
        // Errors are swallowed: if the collection write fails, the user
        // still gets a working session, they just won't pass the
        // contest-access gate; the operator will see a `vigilguard.write_fail`
        // entry in Oplog and the Qt Client can retry.
        try {
            await persistVigilClientSession(this, result, sessionId);
        } catch (e: any) {
            await OplogModel.log(this as any, 'vigilguard.write_fail', {
                sessionId,
                ojContestId: result.ojContestId,
                error: e?.message || String(e),
            });
        }

        // 302 to the real exam-mode page. Falling back to /exam-mode (the
        // home list) is defensive — should never trigger with a valid token.
        this.response.redirect = result.ojContestId
            ? `/exam-mode/${result.ojContestId}`
            : '/exam-mode';
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
        _args: any, studentIdInput: string, realNameInput: string, machineId: string,
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
    async post(_args: any, sessionId: string, ojUserId: number, ojContestId: string) {
        const tid = new ObjectId(ojContestId);
        const PaperDraftModel = (global as any).Hydro?.model?.paper_draft
            || (await import('../model/paper-draft')).default;
        const contestModel = await import('../model/contest');
        const recordModel = await import('../model/record');
        const yaml = await import('js-yaml');

        // We don't know which OJ domain — pull it from the contest doc.
        const tdoc: any = await db.collection('document')
            .findOne({ docId: tid, docType: 30 /* TYPE_CONTEST */ });
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
        const { closeSessionOnVigil } = require('../service/vigil-bridge');
        await closeSessionOnVigil(ojContestId, sessionId, 'force_finalize');
        await deleteLocalClientSession(sessionId);

        this.response.body = { ok: true, rids, count: rids.length };
    }
}

// ─── Admin dashboard shell handlers ──────────────────────────────────────

class VigilAdminOverviewHandler extends Handler {
    async prepare() { this.checkPriv(PRIV.PRIV_EDIT_SYSTEM); }
    async get() {
        const now = new Date();
        // Include contests that have not started yet but are within the
        // 24-hour upcoming window — students legitimately log in early
        // (审批 / scope / time-window pre-check is on Vigil's side) and
        // the dashboard's "进行中" bucket needs to surface them so the
        // approval rows aren't misfiled into "已结束".
        const upcomingHorizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const activeVigilContests = await document.coll.find({
            docType: document.TYPE_CONTEST,
            vigilEnabled: true,
            beginAt: { $lte: upcomingHorizon },
            endAt: { $gt: now },
        }).project({
            domainId: 1,
            docId: 1,
            title: 1,
            beginAt: 1,
            endAt: 1,
            rule: 1,
            entryMode: 1,
        }).sort({ beginAt: -1 }).toArray();
        this.response.template = 'admin_vigil_overview.html';
        this.response.body = {
            activeVigilContests: activeVigilContests.map((tdoc: any) => ({
                domainId: tdoc.domainId,
                examId: String(tdoc.docId),
                title: tdoc.title || String(tdoc.docId),
                beginAt: tdoc.beginAt,
                endAt: tdoc.endAt,
                rule: tdoc.rule || '',
                entryMode: tdoc.entryMode || 'open',
            })),
        };
    }
}

// Exam-scoped detail handler — all sub-views (sessions / approvals / events
// / overview) for one Hydro contest. The React page reads :examId and
// filters client-side.
class VigilAdminExamDetailHandler extends Handler {
    async prepare() { this.checkPriv(PRIV.PRIV_EDIT_SYSTEM); }
    async get({ domainId, examId }: { domainId: string; examId: string }) {
        let examTitle: string | null = null;
        let liveEnabled = true;
        let recordEnabled = false;
        let cameraEnabled = true;
        if (ObjectId.isValid(examId)) {
            try {
                const tid = new ObjectId(examId);
                const tdoc = await contestModel.get(domainId || 'system', tid).catch(() => null)
                    || await document.coll.findOne({ docType: document.TYPE_CONTEST, docId: tid });
                if (tdoc?.title) examTitle = tdoc.title;
                if (tdoc) {
                    liveEnabled = tdoc.liveEnabled !== false;
                    recordEnabled = !!tdoc.recordEnabled;
                    cameraEnabled = tdoc.cameraEnabled !== false;
                }
            } catch { /* not found → leave null, React falls back to id */ }
        }
        this.response.template = 'admin_vigil_exam_detail.html';
        this.response.body = {
            examId,
            examTitle,
            liveEnabled,
            recordEnabled,
            cameraEnabled,
        };
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
    async post({ domainId: _domainId }: { domainId: string }, ids: string[] = []) {
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

// ─── GET /api/admin/vigil/check-hls-access ────────────────────────────────

/**
 * Forward-auth target for Caddy's `/vigil-hls/*` reverse proxy.
 *
 * Caddy calls this with the OJ session cookie attached, before proxying any
 * HLS request to oj-vigil's SRS. We respond 200 to allow, 403 to deny.
 *
 * URL pattern: `?path=/vigil-hls/<live-record|live-nodvr>/{contestId}_{machineId}_{screen|camera}.m3u8`
 *            or `?path=/vigil-hls/<live-record|live-nodvr>/{contestId}_{machineId}_{screen|camera}-N.ts`
 *            or `?path=/vigil-hls/recordings/{contestId}_{machineId}_{screen|camera}_{ts}.mp4`
 *
 * Auth: PRIV_EDIT_SYSTEM (same gate as `/admin/vigil` page itself). The
 * contest-id parsed from the path is currently used only for logging — any
 * site admin can watch any vigil-enabled contest's stream. If finer-grained
 * proctor permission is added later, validate contestId here.
 */
class VigilCheckHlsAccessHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }

    async get() {
        const path = String((this.request.query as any).path || '');
        // Path shapes:
        //   /vigil-hls/live-record/{contestId}_{machineId}_{type}.m3u8|ts
        //   /vigil-hls/recordings/{contestId}_{machineId}_{type}_{ts}.mp4
        //
        // contestId is the OJ contest's Mongo ObjectId (24 hex chars).
        // machineId is whatever the Krypton client picked — current scheme
        // is `m_<20-hex>` which contains both lowercase letters and an
        // underscore, so the middle segment regex must accept those.
        // Use `.+?` (non-greedy) so the trailing `_screen|_camera`
        // anchor wins; otherwise greedy `.+` would swallow the type.
        const liveMatch = path.match(
            /^\/vigil-hls\/(live-record|live-nodvr)\/([0-9a-f]{24})_(.+?)_(screen|camera)(?:-\d+)?\.(m3u8|ts)$/,
        );
        const recMatch = path.match(
            /^\/vigil-hls\/recordings\/([0-9a-f]{24})_(.+?)_(screen|camera)(?:_\d{8}_\d{6})?\.mp4$/,
        );
        // Low-latency HTTP-FLV live path (mpegts.js), proxied by Caddy's
        // /vigil-flv/*: /vigil-flv/{live-record|live-nodvr}/{contestId}_{machineId}_{type}.flv
        const flvMatch = path.match(
            /^\/vigil-flv\/(live-record|live-nodvr)\/([0-9a-f]{24})_(.+?)_(screen|camera)\.flv$/,
        );
        if (!liveMatch && !recMatch && !flvMatch) {
            this.response.status = 403;
            this.response.body = { error: 'invalid path' };
            return;
        }
        // PRIV_EDIT_SYSTEM was already checked in prepare(). Allow.
        this.response.status = 200;
        this.response.body = { ok: true };
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
    ctx.Route('vigil_student_finish', '/api/vigil/student-finish', VigilStudentFinishHandler);
    ctx.Route('vigil_reset_student_finish', '/api/vigil/reset-student-finish', VigilResetStudentFinishHandler);
    ctx.Route('vigil_exchange_access_token', '/api/vigil/exchange-access-token', VigilExchangeAccessTokenHandler);
    // Public — no PRIV gate. Bootstrap a session from a Vigil-issued token.
    // Path lives outside `/exam-mode/*` because the `:tid` ObjectId validator
    // would reject the string "launch" before this handler ever ran.
    ctx.Route('vigil_launch', '/vigil-launch', VigilExamModeLaunchHandler);
    ctx.Route('vigil_temporary_user', '/api/vigil/temporary-user', VigilTemporaryUserHandler);
    ctx.Route('vigil_force_finalize', '/api/vigil/force-finalize', VigilForceFinalizeHandler);
    ctx.Route('vigil_dashboard_token', '/api/admin/vigil/dashboard-token', VigilDashboardTokenHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('vigil_check_hls_access', '/api/admin/vigil/check-hls-access', VigilCheckHlsAccessHandler, PRIV.PRIV_EDIT_SYSTEM);
}
