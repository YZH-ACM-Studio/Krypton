import { ObjectId } from 'mongodb';
import { studentDirectory } from '../service/student-directory';

export interface StaffScopeActor {
    _id: number;
    parentSchoolId?: ObjectId[];
}

function hexOf(schoolId: ObjectId): string {
    return schoolId.toHexString();
}

function compareHex(left: ObjectId, right: ObjectId): number {
    const leftHex = hexOf(left);
    const rightHex = hexOf(right);
    if (leftHex < rightHex) return -1;
    if (leftHex > rightHex) return 1;
    return 0;
}

/** 老师学校范围唯一口径：parentSchoolId ∪ 本人学生记录学校 ∪ staffUids 含本人的学校；只返回仍存在的学校，按 hex 去重。 */
export async function resolveStaffSchoolScope(domainId: string, actor: StaffScopeActor): Promise<ObjectId[]> {
    const directory = studentDirectory();
    const schools = await directory.listSchools(domainId);
    const existing = new Set<string>();
    for (const school of schools) existing.add(hexOf(school._id));

    const selected: ObjectId[] = [];
    const seen = new Set<string>();
    const addIfExists = (schoolId: unknown) => {
        if (!(schoolId instanceof ObjectId)) return;
        const hex = hexOf(schoolId);
        if (!existing.has(hex)) return;
        if (seen.has(hex)) return;
        seen.add(hex);
        selected.push(schoolId);
    };

    for (const schoolId of actor.parentSchoolId || []) addIfExists(schoolId);
    const student = await directory.findStudentByUserId(domainId, actor._id);
    addIfExists(student?.schoolId);
    for (const school of schools) {
        if (school.staffUids?.includes(actor._id)) addIfExists(school._id);
    }
    selected.sort(compareHex);
    return selected;
}

export async function isSchoolInStaffScope(domainId: string, actor: StaffScopeActor, schoolId: ObjectId): Promise<boolean> {
    const scope = await resolveStaffSchoolScope(domainId, actor);
    return scope.some((candidate) => candidate.equals(schoolId));
}
