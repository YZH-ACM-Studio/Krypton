/**
 * Cross-domain export / import — PRD §3.8.
 *
 * "Take all userbind data from domain A, drop it into domain B."
 * Used when an admin reorganises domains and wants to seed a new domain
 * with an existing school/group/student roster.
 *
 * Bindings (`StudentRecord.boundUserId`) are NOT carried across: a user's
 * membership in a domain is managed by Hydro's native `domain.addMember`,
 * and binding is a domain-local relationship. The export package strips
 * `boundUserId` / `boundAt`; the operator must rebind in the target domain
 * (e.g. by re-issuing invite tokens or letting students self-request).
 */
import { ObjectId } from 'hydrooj';
import {
    bindTokensColl, schoolsColl, studentsColl, userGroupsColl,
} from './db';
import type {
    ExportPackage, ImportConflictPolicy, ImportReport, School, StudentRecord, UserGroup,
} from './types';
import { userBindModel } from './model';

export async function exportDomain(domainId: string): Promise<ExportPackage> {
    const [schools, userGroups, students, bindTokens] = await Promise.all([
        schoolsColl.find({ domainId }).toArray(),
        userGroupsColl.find({ domainId }).toArray(),
        studentsColl.find({ domainId }).toArray(),
        bindTokensColl.find({ domainId, used: false }).toArray(),
    ]);

    return {
        version: 1,
        sourceDomainId: domainId,
        exportedAt: new Date().toISOString(),
        schools,
        userGroups,
        students: students.map((s) => {
            const { boundUserId, boundAt, ...rest } = s;
            return rest;
        }),
        bindTokens,
    };
}

export async function importDomain(
    targetDomainId: string, pkg: ExportPackage, policy: ImportConflictPolicy,
): Promise<ImportReport> {
    if (!pkg || pkg.version !== 1) {
        throw new Error('Unsupported export package version');
    }
    const report: ImportReport = {
        schoolsInserted: 0,
        groupsInserted: 0,
        studentsInserted: 0,
        tokensInserted: 0,
        conflicts: [],
    };

    // Build mappings from old IDs to new IDs (since we generate fresh _ids).
    const schoolIdMap = new Map<string, ObjectId>(); // old _id → new _id
    const groupIdMap = new Map<string, ObjectId>();
    const studentIdMap = new Map<string, ObjectId>();

    // Schools
    for (const oldSchool of pkg.schools) {
        const existing = await schoolsColl.findOne({
            domainId: targetDomainId, name: oldSchool.name,
        });
        if (existing) {
            const action = handleConflict('school', oldSchool.name, policy);
            report.conflicts.push({ kind: 'school', identifier: oldSchool.name, action });
            if (action === 'errored') {
                throw new Error(`Conflict: school "${oldSchool.name}" already exists in domain ${targetDomainId}`);
            }
            if (action === 'skipped') {
                schoolIdMap.set(oldSchool._id.toString(), existing._id);
                continue;
            }
            // overwrite: keep existing _id, update other fields
            schoolIdMap.set(oldSchool._id.toString(), existing._id);
        } else {
            const newId = new ObjectId();
            await schoolsColl.insertOne({
                _id: newId,
                domainId: targetDomainId,
                name: oldSchool.name,
                createdAt: new Date(),
                createdBy: oldSchool.createdBy,
            });
            schoolIdMap.set(oldSchool._id.toString(), newId);
            report.schoolsInserted++;
        }
    }

    // User groups
    for (const oldGroup of pkg.userGroups) {
        const newSchoolId = schoolIdMap.get(oldGroup.schoolId.toString());
        if (!newSchoolId) continue;
        const existing = await userGroupsColl.findOne({
            domainId: targetDomainId, schoolId: newSchoolId, name: oldGroup.name,
        });
        if (existing) {
            const action = handleConflict('group', oldGroup.name, policy);
            report.conflicts.push({ kind: 'group', identifier: oldGroup.name, action });
            if (action === 'errored') {
                throw new Error(`Conflict: group "${oldGroup.name}" in school exists`);
            }
            if (action === 'skipped') {
                groupIdMap.set(oldGroup._id.toString(), existing._id);
                continue;
            }
            groupIdMap.set(oldGroup._id.toString(), existing._id);
        } else {
            const newId = new ObjectId();
            await userGroupsColl.insertOne({
                _id: newId,
                domainId: targetDomainId,
                schoolId: newSchoolId,
                name: oldGroup.name,
                createdAt: new Date(),
                createdBy: oldGroup.createdBy,
            });
            groupIdMap.set(oldGroup._id.toString(), newId);
            report.groupsInserted++;
        }
    }

    // Students
    for (const oldStudent of pkg.students) {
        const newSchoolId = schoolIdMap.get(oldStudent.schoolId.toString());
        if (!newSchoolId) continue;
        const newGroupIds = oldStudent.groupIds
            .map((gid) => groupIdMap.get(gid.toString()))
            .filter((id): id is ObjectId => !!id);
        const existing = await studentsColl.findOne({
            domainId: targetDomainId, schoolId: newSchoolId, studentId: oldStudent.studentId,
        });
        if (existing) {
            const action = handleConflict('student', oldStudent.studentId, policy);
            report.conflicts.push({ kind: 'student', identifier: oldStudent.studentId, action });
            if (action === 'errored') {
                throw new Error(`Conflict: student "${oldStudent.studentId}" exists in target school`);
            }
            if (action === 'overwritten') {
                await studentsColl.updateOne(
                    { _id: existing._id },
                    { $set: { realName: oldStudent.realName, groupIds: newGroupIds } },
                );
            }
            studentIdMap.set(oldStudent._id.toString(), existing._id);
        } else {
            const newId = new ObjectId();
            await studentsColl.insertOne({
                _id: newId,
                domainId: targetDomainId,
                schoolId: newSchoolId,
                studentId: oldStudent.studentId,
                realName: oldStudent.realName,
                groupIds: newGroupIds,
                boundUserId: null,
                boundAt: null,
                createdAt: new Date(),
                createdBy: oldStudent.createdBy,
            });
            studentIdMap.set(oldStudent._id.toString(), newId);
            report.studentsInserted++;
        }
    }

    // Bind tokens (only unused are exported, see exportDomain)
    for (const oldToken of pkg.bindTokens) {
        const newStudentId = studentIdMap.get(oldToken.studentRecordId.toString());
        if (!newStudentId) continue;
        const existing = await bindTokensColl.findOne({ _id: oldToken._id });
        if (existing) {
            const action = handleConflict('token', oldToken._id, policy);
            report.conflicts.push({ kind: 'token', identifier: oldToken._id.slice(0, 16), action });
            continue;
        }
        await bindTokensColl.insertOne({
            _id: oldToken._id,
            domainId: targetDomainId,
            studentRecordId: newStudentId,
            createdAt: new Date(),
            createdBy: oldToken.createdBy,
            expiresAt: oldToken.expiresAt,
            used: false,
            usedBy: null,
            usedAt: null,
        });
        report.tokensInserted++;
    }

    return report;
}

function handleConflict(
    _kind: string, _ident: string, policy: ImportConflictPolicy,
): 'skipped' | 'overwritten' | 'errored' {
    switch (policy) {
        case 'skip': return 'skipped';
        case 'overwrite': return 'overwritten';
        case 'error':
        default: return 'errored';
    }
}

// Wire into the facade.
userBindModel.exportDomain = exportDomain;
userBindModel.importDomain = importDomain as any;
