/**
 * System-admin teacher roster and teacher-role capability switches.
 * POST is handled on `all` so an unknown operation is a ValidationError.
 * Hydro only reaches the verb method after rejecting unknown post* names,
 * and it calls `all` for GET as well — GET returns before any write.
 */
import { TEACHER_CAPABILITIES, TEACHER_CAPABILITY_MASK, type TeacherCapabilityKey } from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import {
    db,
    DomainModel,
    ForbiddenError,
    Handler,
    localizedErrorText,
    localizeError,
    NotFoundError,
    ObjectId,
    OplogModel,
    PERM,
    PRIV,
    UserModel,
    ValidationError,
} from 'hydrooj';
import type { Context } from 'hydrooj';
import { schoolsColl, userGroupsColl } from './db';

const logger = new Logger('userbind.teacher-admin');

const DOC_CONTEST = 30;
const DOC_TRAINING = 40;
const SCHOOL_ID = /^[a-f0-9]{24}$/i;
const DECIMAL = /^\d+$/;

interface SchoolRow {
    id: string;
    name: string;
    staffUids: number[];
}

interface OwnedCounts {
    courses: number;
    sets: number;
    groups: number;
}

interface TeacherRow {
    uid: number;
    uname: string;
    schoolIds: string[];
    owned: OwnedCounts;
    loginAt: string | null;
}

function domainIdOf(handler: Handler): string {
    const raw = handler.domain?._id;
    const domainId = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
    if (!domainId) throw new ValidationError('domainId');
    return domainId;
}

function isReadRequest(handler: Handler): boolean {
    const method = handler.request?.method;
    return method === 'get' || method === 'head';
}

function isUsableSystemAdmin(priv: number): boolean {
    return priv !== PRIV.PRIV_NONE
        && (priv & PRIV.PRIV_EDIT_SYSTEM) === PRIV.PRIV_EDIT_SYSTEM
        && (priv & PRIV.PRIV_USER_PROFILE) === PRIV.PRIV_USER_PROFILE;
}

function reject(domainId: string, actorUid: number, target: number | string, stage: string, reason: string, error: Error): never {
    logger.warn('domain=%s uid=%s target=%s stage=%s result=rejected reason=%s', domainId, actorUid, target, stage, reason);
    throw error;
}

async function runStage<T>(domainId: string, actorUid: number, target: number | string, stage: string, work: () => Promise<T>): Promise<T> {
    try {
        return await work();
    } catch (error) {
        logger.error('domain=%s uid=%s target=%s stage=%s result=failed error=%o', domainId, actorUid, target, stage, error);
        throw error;
    }
}

async function requireAdminPassword(handler: Handler, password: unknown): Promise<void> {
    const domainId = domainIdOf(handler);
    const actorUid = handler.user._id;
    try {
        await handler.limitRate('admin_teachers_password', 60, 5, '{{ip}}@{{user}}');
    } catch (error) {
        logger.warn('domain=%s uid=%s stage=password result=rejected reason=rate_limit', domainId, actorUid);
        throw error;
    }
    if (typeof password !== 'string') {
        reject(domainId, actorUid, actorUid, 'password', 'missing', new ValidationError('password', null, localizedErrorText`请输入管理员密码`));
    }
    try {
        await handler.user.checkPassword(password);
    } catch (error) {
        logger.warn('domain=%s uid=%s stage=password result=rejected reason=mismatch', domainId, actorUid);
        throw error;
    }
    const actor = await db.collection<{ _id: number; priv?: unknown }>('user').findOne({ _id: actorUid });
    const priv = typeof actor?.priv === 'number' ? actor.priv : Number.NaN;
    if (!actor || !Number.isSafeInteger(priv) || !isUsableSystemAdmin(priv)) {
        reject(
            domainId,
            actorUid,
            actorUid,
            'privilege',
            'not_system_admin',
            new ForbiddenError(localizedErrorText`当前账号已不再拥有系统管理权限`),
        );
    }
}

function parseUid(raw: unknown): number {
    if (typeof raw === 'number') {
        if (!Number.isSafeInteger(raw) || raw <= 0) {
            throw new ValidationError('uid', null, localizedErrorText`账号参数无效`);
        }
        return raw;
    }
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) {
        throw new ValidationError('uid', null, localizedErrorText`账号参数无效`);
    }
    const uid = Number(raw);
    if (!Number.isSafeInteger(uid)) throw new ValidationError('uid', null, localizedErrorText`账号参数无效`);
    return uid;
}

function parseSchoolIdList(raw: unknown): string[] {
    if (raw == null || raw === '') return [];
    if (typeof raw !== 'string') throw new ValidationError('schoolIds', null, localizedErrorText`学校参数无效`);
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const part of raw.split(',')) {
        const token = part.trim();
        if (!token) continue;
        if (!SCHOOL_ID.test(token) || !ObjectId.isValid(token)) {
            throw new ValidationError('schoolIds', null, localizedErrorText`学校不存在`);
        }
        const id = token.toLowerCase();
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
    }
    return ids;
}

function staffUidsOf(value: unknown): number[] {
    if (value == null) return [];
    if (!Array.isArray(value)) throw new ValidationError('staffUids', null, localizedErrorText`学校教职工数据无效`);
    return value.map((uid) => {
        if (typeof uid !== 'number' || !Number.isSafeInteger(uid)) {
            throw new ValidationError('staffUids', null, localizedErrorText`学校教职工数据无效`);
        }
        return uid;
    });
}

async function loadSchools(domainId: string): Promise<SchoolRow[]> {
    const docs = await schoolsColl.find({ domainId }).toArray();
    const schools = docs.map((school) => {
        if (typeof school.name !== 'string' || !school.name) {
            throw new ValidationError('school', null, localizedErrorText`学校名称无效`);
        }
        return {
            id: school._id.toHexString(),
            name: school.name,
            staffUids: staffUidsOf(school.staffUids),
        };
    });
    schools.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id));
    return schools;
}

async function resolveSchools(domainId: string, raw: unknown): Promise<ObjectId[]> {
    const wanted = parseSchoolIdList(raw);
    if (!wanted.length) return [];
    const schools = await loadSchools(domainId);
    const byId = new Map(schools.map((school) => [school.id, school.id]));
    const resolved: ObjectId[] = [];
    for (const id of wanted) {
        const found = byId.get(id);
        if (!found) throw new ValidationError('schoolIds', null, localizedErrorText`学校不存在`);
        resolved.push(new ObjectId(found));
    }
    return resolved;
}

async function membershipRole(domainId: string, uid: number): Promise<string | null> {
    const membership = await db.collection<{ domainId: string; uid: number; role?: unknown }>('domain.user').findOne({ domainId, uid });
    if (!membership) return null;
    if (typeof membership.role !== 'string' || !membership.role) return 'default';
    return membership.role;
}

async function requireAccount(domainId: string, actorUid: number, uid: number) {
    const user = await UserModel.getById(domainId, uid);
    if (!user) {
        reject(domainId, actorUid, uid, 'load_user', 'user_not_found', localizeError(new NotFoundError(uid), '用户不存在'));
    }
    return user;
}

async function requireTeacher(domainId: string, actorUid: number, uid: number): Promise<void> {
    await requireAccount(domainId, actorUid, uid);
    const role = await membershipRole(domainId, uid);
    if (role !== 'teacher') {
        reject(domainId, actorUid, uid, 'role', 'not_teacher', new ValidationError('uid', null, localizedErrorText`这个账号不是老师。`));
    }
}

function loginAtIso(value: unknown): string | null {
    if (value == null) return null;
    const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) {
        throw new ValidationError('loginat', null, localizedErrorText`最近登录时间无效`);
    }
    return date.toISOString();
}

async function ownedCounts(domainId: string, uid: number): Promise<OwnedCounts> {
    const documents = db.collection('document');
    const [courses, contests, problemSets, groups] = await Promise.all([
        documents.countDocuments({
            domainId,
            docType: DOC_TRAINING,
            kind: 'course',
            owner: uid,
        }),
        documents.countDocuments({ domainId, docType: DOC_CONTEST, owner: uid }),
        documents.countDocuments({
            domainId,
            docType: DOC_TRAINING,
            owner: uid,
            $or: [{ kind: 'problem_set' }, { kind: 'training' }, { kind: { $exists: false } }],
        }),
        userGroupsColl.countDocuments({ domainId, ownerUid: uid, archivedAt: { $exists: false } }),
    ]);
    return { courses, sets: contests + problemSets, groups };
}

async function loadTeachers(domainId: string, schools: SchoolRow[]): Promise<TeacherRow[]> {
    const memberships = await db.collection<{ uid?: unknown }>('domain.user').find({ domainId, role: 'teacher' }).toArray();
    const rows: TeacherRow[] = [];
    for (const membership of memberships) {
        const uid = membership.uid;
        if (typeof uid !== 'number' || !Number.isSafeInteger(uid) || uid <= 0) {
            throw new ValidationError('uid', null, localizedErrorText`老师名单里的账号无效`);
        }
        const user = await db.collection<{ _id: number; uname?: unknown; loginat?: unknown }>('user').findOne({ _id: uid });
        if (!user || typeof user.uname !== 'string' || !user.uname) throw localizeError(new NotFoundError(uid), '用户不存在');
        rows.push({
            uid,
            uname: user.uname,
            schoolIds: schools.filter((school) => school.staffUids.includes(uid)).map((school) => school.id),
            owned: await ownedCounts(domainId, uid),
            loginAt: loginAtIso(user.loginat),
        });
    }
    rows.sort((left, right) => left.uname.localeCompare(right.uname, 'en') || left.uid - right.uid);
    return rows;
}

function storedTeacherPermission(roles: Record<string, string> | undefined): string | undefined {
    if (!roles || !Object.hasOwn(roles, 'teacher')) return undefined;
    const stored = roles.teacher;
    if (typeof stored !== 'string' || !DECIMAL.test(stored)) {
        throw new ValidationError('roles.teacher', null, localizedErrorText`老师权限数据无效`);
    }
    return stored;
}

async function loadCapabilities(domainId: string) {
    const domain = await DomainModel.get(domainId);
    if (!domain) throw localizeError(new NotFoundError(domainId), '域不存在');
    const stored = storedTeacherPermission(domain.roles);
    const effective = stored === undefined ? PERM.PERM_TEACHER : BigInt(stored);
    return {
        customized: stored !== undefined,
        stored: stored === undefined ? null : stored,
        effective: effective.toString(),
        items: TEACHER_CAPABILITIES.map((item) => ({
            key: item.key,
            enabled: (effective & item.perm) !== 0n,
            defaultEnabled: (PERM.PERM_TEACHER & item.perm) !== 0n,
        })),
    };
}

async function addStaff(domainId: string, schoolId: ObjectId, uid: number): Promise<void> {
    const result = await schoolsColl.updateOne({ domainId, _id: schoolId }, { $addToSet: { staffUids: uid } });
    if (!result.matchedCount) throw new ValidationError('schoolIds', null, localizedErrorText`学校不存在`);
}

async function removeStaff(domainId: string, uid: number, schoolIds?: ObjectId[]): Promise<void> {
    const filter = schoolIds ? { domainId, _id: { $in: schoolIds } } : { domainId };
    await schoolsColl.updateMany(filter, { $pull: { staffUids: uid } });
}

async function setTeacher(handler: Handler, domainId: string, raw: Record<string, unknown>): Promise<void> {
    const actorUid = handler.user._id;
    const uid = parseUid(raw.uid);
    const schoolIds = await resolveSchools(domainId, raw.schoolIds);
    await requireAccount(domainId, actorUid, uid);
    const role = await membershipRole(domainId, uid);
    if (role === 'root') {
        reject(domainId, actorUid, uid, 'role', 'domain_root', new ValidationError('uid', null, localizedErrorText`这个账号是域管理员，不能改成老师。`));
    }
    if (role === 'teacher') {
        reject(domainId, actorUid, uid, 'role', 'already_teacher', new ValidationError('uid', null, localizedErrorText`这个账号已经是老师。`));
    }
    await runStage(domainId, actorUid, uid, 'set_role', () => DomainModel.setUserRole(domainId, uid, 'teacher', true));
    await runStage(domainId, actorUid, uid, 'add_staff', async () => {
        for (const schoolId of schoolIds) await addStaff(domainId, schoolId, uid);
    });
    const schoolHex = schoolIds.map((id) => id.toHexString());
    await runStage(domainId, actorUid, uid, 'oplog', () => OplogModel.log(handler, 'userbind.admin.set_teacher', {
        domainId,
        targetUid: uid,
        schoolIds: schoolHex,
    }));
    logger.info('domain=%s uid=%s target=%s stage=set_teacher result=ok schools=%s', domainId, actorUid, uid, schoolHex.length);
}

async function setSchools(handler: Handler, domainId: string, raw: Record<string, unknown>): Promise<void> {
    const actorUid = handler.user._id;
    const uid = parseUid(raw.uid);
    const schoolIds = await resolveSchools(domainId, raw.schoolIds);
    await requireTeacher(domainId, actorUid, uid);
    await runStage(domainId, actorUid, uid, 'replace_staff', async () => {
        await removeStaff(domainId, uid);
        for (const schoolId of schoolIds) await addStaff(domainId, schoolId, uid);
    });
    const schoolHex = schoolIds.map((id) => id.toHexString());
    await runStage(domainId, actorUid, uid, 'oplog', () => OplogModel.log(handler, 'userbind.admin.set_schools', {
        domainId,
        targetUid: uid,
        schoolIds: schoolHex,
    }));
    logger.info('domain=%s uid=%s target=%s stage=set_schools result=ok schools=%s', domainId, actorUid, uid, schoolHex.length);
}

async function unsetTeacher(handler: Handler, domainId: string, raw: Record<string, unknown>): Promise<void> {
    const actorUid = handler.user._id;
    const uid = parseUid(raw.uid);
    if (raw.removeStaff !== '1' && raw.removeStaff !== '0') {
        throw new ValidationError('removeStaff', null, localizedErrorText`是否移除教职工参数无效`);
    }
    const remove = raw.removeStaff === '1';
    await requireTeacher(domainId, actorUid, uid);
    await runStage(domainId, actorUid, uid, 'set_role', () => DomainModel.setUserRole(domainId, uid, 'default'));
    if (remove) {
        await runStage(domainId, actorUid, uid, 'remove_staff', () => removeStaff(domainId, uid));
    }
    await runStage(domainId, actorUid, uid, 'oplog', () => OplogModel.log(handler, 'userbind.admin.unset_teacher', {
        domainId,
        targetUid: uid,
    }));
    logger.info('domain=%s uid=%s target=%s stage=unset_teacher result=ok removeStaff=%s', domainId, actorUid, uid, remove ? '1' : '0');
}

function parseCapabilityKeys(raw: unknown): TeacherCapabilityKey[] {
    if (raw == null || raw === '') return [];
    if (typeof raw !== 'string') throw new ValidationError('enabled', null, localizedErrorText`老师能力参数无效`);
    const known = new Map<string, TeacherCapabilityKey>(TEACHER_CAPABILITIES.map((item) => [item.key, item.key]));
    const selected: TeacherCapabilityKey[] = [];
    const seen = new Set<string>();
    for (const part of raw.split(',')) {
        const key = part.trim();
        if (!key) continue;
        const canonical = known.get(key);
        if (!canonical) throw new ValidationError('enabled', null, localizedErrorText`未知的老师能力`);
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        selected.push(canonical);
    }
    return selected;
}

function permissionBits(keys: readonly TeacherCapabilityKey[]): bigint {
    let bits = 0n;
    for (const item of TEACHER_CAPABILITIES) {
        if (keys.includes(item.key)) bits |= item.perm;
    }
    return bits;
}

async function saveCapabilities(handler: Handler, domainId: string, raw: Record<string, unknown>): Promise<void> {
    const actorUid = handler.user._id;
    const enabled = parseCapabilityKeys(raw.enabled);
    if (typeof raw.expected !== 'string' || !DECIMAL.test(raw.expected)) {
        throw new ValidationError('expected', null, localizedErrorText`权限版本无效`);
    }
    const expected = BigInt(raw.expected);
    const next = (expected & ~TEACHER_CAPABILITY_MASK) | permissionBits(enabled);
    const result = await runStage(domainId, actorUid, 'teacher', 'save_capabilities', () => DomainModel.compareAndSetRolePermission(domainId, 'teacher', expected, next));
    if (result.state === 'conflict') {
        reject(domainId, actorUid, 'teacher', 'save_capabilities', 'conflict', new ValidationError('expected', null, localizedErrorText`老师权限已被别人改过，请刷新后再改。`));
    }
    if (result.state !== 'updated') {
        logger.error('domain=%s uid=%s target=teacher stage=save_capabilities result=failed state=%s', domainId, actorUid, result.state);
        throw new ValidationError('expected', null, localizedErrorText`老师权限没有写入`);
    }
    await runStage(domainId, actorUid, 'teacher', 'oplog', () => OplogModel.log(handler, 'userbind.admin.save_capabilities', {
        domainId,
        enabled,
    }));
    logger.info('domain=%s uid=%s target=teacher stage=save_capabilities result=ok enabled=%s', domainId, actorUid, enabled.length);
}

async function resetCapabilities(handler: Handler, domainId: string, raw: Record<string, unknown>): Promise<void> {
    const actorUid = handler.user._id;
    if (typeof raw.expected !== 'string' || (raw.expected !== '' && !DECIMAL.test(raw.expected))) {
        throw new ValidationError('expected', null, localizedErrorText`权限版本无效`);
    }
    const result = await runStage(
        domainId,
        actorUid,
        'teacher',
        'reset_capabilities',
        () => DomainModel.resetBuiltinRolePermission(domainId, 'teacher', raw.expected as string),
    );
    if (result.state === 'conflict') {
        reject(domainId, actorUid, 'teacher', 'reset_capabilities', 'conflict', new ValidationError('expected', null, localizedErrorText`老师权限已被别人改过，请刷新后再改。`));
    }
    if (result.state !== 'reset' && result.state !== 'missing') {
        logger.error('domain=%s uid=%s target=teacher stage=reset_capabilities result=failed state=%s', domainId, actorUid, result.state);
        throw new ValidationError('expected', null, localizedErrorText`不能恢复这个角色的权限。`);
    }
    await runStage(domainId, actorUid, 'teacher', 'oplog', () => OplogModel.log(handler, 'userbind.admin.reset_capabilities', { domainId }));
    logger.info('domain=%s uid=%s target=teacher stage=reset_capabilities result=ok state=%s', domainId, actorUid, result.state);
}

async function dispatchPost(handler: Handler, raw: Record<string, unknown>): Promise<void> {
    const domainId = domainIdOf(handler);
    await requireAdminPassword(handler, raw.password);
    const operation = typeof raw.operation === 'string' ? raw.operation.trim() : '';
    if (operation === 'set_teacher') await setTeacher(handler, domainId, raw);
    else if (operation === 'set_schools') await setSchools(handler, domainId, raw);
    else if (operation === 'unset_teacher') await unsetTeacher(handler, domainId, raw);
    else if (operation === 'save_capabilities') await saveCapabilities(handler, domainId, raw);
    else if (operation === 'reset_capabilities') await resetCapabilities(handler, domainId, raw);
    else {
        reject(
            domainId,
            handler.user._id,
            operation || '-',
            'operation',
            'unknown',
            new ValidationError('operation', null, localizedErrorText`未知操作`),
        );
    }
    handler.response.body = { ok: true };
}

class AdminTeachersHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }

    async get() {
        const domainId = domainIdOf(this);
        const schools = await loadSchools(domainId);
        this.response.template = 'admin_teachers.html';
        this.response.body = {
            teachers: await loadTeachers(domainId, schools),
            schools: schools.map((school) => ({ id: school.id, name: school.name })),
            capabilities: await loadCapabilities(domainId),
        };
    }

    async all(raw?: Record<string, unknown>) {
        if (isReadRequest(this)) return;
        const args = raw && typeof raw === 'object' ? raw : {};
        const operation = args.operation ?? this.request.body?.operation;
        if (typeof this.request.method === 'string' && this.request.method !== 'post' && operation == null) return;
        await dispatchPost(this, { ...args, operation });
    }
}

export function applyTeacherAdminHandlers(ctx: Context) {
    ctx.Route('admin_teachers', '/admin/teachers', AdminTeachersHandler, PRIV.PRIV_EDIT_SYSTEM);
}
