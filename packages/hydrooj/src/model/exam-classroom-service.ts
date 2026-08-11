import type { Collection } from 'mongodb';
import { ObjectId } from 'mongodb';
import {
    assertExamClassroomIntegrity,
    ClassSigninClassroomMigrationError,
    type ExamClassroomDoc,
    type ExamClassroomLayoutRevision,
} from '../lib/classsignin-classroom-migration';

type ClassroomCollection = Pick<Collection<ExamClassroomDoc>, 'createIndex' | 'find' | 'findOne'>;

export class ExamClassroomService {
    private indexesPromise?: Promise<void>;

    constructor(private readonly classrooms: ClassroomCollection) {}

    ensureIndexes(): Promise<void> {
        this.indexesPromise ||= Promise.all([
            this.classrooms.createIndex(
                { domainId: 1, sourceSystem: 1, sourceClassroomId: 1 },
                { name: 'examClassroomSourceIdentity', unique: true },
            ),
            this.classrooms.createIndex({ domainId: 1, schoolId: 1, status: 1, name: 1 }, { name: 'examClassroomSchoolStatus' }),
        ]).then(() => undefined);
        return this.indexesPromise;
    }

    async get(domainId: string, classroomId: ObjectId, includeArchived = false): Promise<ExamClassroomDoc | null> {
        if (!domainId || domainId.length > 64) throw new TypeError('domainId is invalid');
        if (!(classroomId instanceof ObjectId)) throw new TypeError('classroomId must be an ObjectId');
        const classroom = await this.classrooms.findOne({ domainId, _id: classroomId, ...(includeArchived ? {} : { status: 'active' }) });
        if (classroom) assertExamClassroomIntegrity(classroom);
        return classroom;
    }

    list(domainId: string, schoolId: ObjectId, includeArchived = false, limit = 500) {
        if (!domainId || domainId.length > 64) throw new TypeError('domainId is invalid');
        if (!(schoolId instanceof ObjectId)) throw new TypeError('schoolId must be an ObjectId');
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new TypeError('limit is invalid');
        return this.classrooms
            .find({ domainId, schoolId, ...(includeArchived ? {} : { status: 'active' }) })
            .sort({ name: 1, _id: 1 })
            .limit(limit)
            .map((classroom) => {
                assertExamClassroomIntegrity(classroom);
                return classroom;
            });
    }

    layout(classroom: ExamClassroomDoc, revision = classroom.layoutRevision): ExamClassroomLayoutRevision {
        assertExamClassroomIntegrity(classroom);
        if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('layout revision is invalid');
        const matches = classroom.layoutRevisions.filter((candidate) => candidate.revision === revision);
        if (matches.length !== 1) {
            throw new ClassSigninClassroomMigrationError(
                `classroom ${classroom._id.toHexString()} has no unique layout revision ${revision}`,
                'CLASSSIGNIN_CLASSROOM_LAYOUT_REVISION_INVALID',
            );
        }
        return matches[0];
    }

    seat(classroom: ExamClassroomDoc, revision: number, sourceSeatId: string) {
        const matches = this.layout(classroom, revision).snapshot.seats.filter((seat) => seat.sourceSeatId === sourceSeatId);
        if (matches.length !== 1) {
            throw new ClassSigninClassroomMigrationError(
                `classroom ${classroom._id.toHexString()} layout ${revision} has no unique seat ${sourceSeatId}`,
                'CLASSSIGNIN_CLASSROOM_SEAT_INVALID',
            );
        }
        return matches[0];
    }
}
