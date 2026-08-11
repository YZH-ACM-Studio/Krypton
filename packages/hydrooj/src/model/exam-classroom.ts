import { Context } from '../context';
import { type ClassSigninClassroomMigrationBatchDoc, type ExamClassroomDoc } from '../lib/classsignin-classroom-migration';
import db from '../service/db';
import { settleDomainCleanupOperations } from './domain-lifecycle-boundary';
import { ExamClassroomService } from './exam-classroom-service';

export { ExamClassroomService } from './exam-classroom-service';

export const examClassroomColl = db.collection<ExamClassroomDoc>('exam.classrooms');
export const examClassroomMigrationBatchColl = db.collection<ClassSigninClassroomMigrationBatchDoc>('exam.classroomImportBatches');
export const examClassroomService = new ExamClassroomService(examClassroomColl);

export async function apply(ctx: Context): Promise<void> {
    await examClassroomService.ensureIndexes();
    ctx.on('domain/delete', async (domainId) => {
        await settleDomainCleanupOperations(domainId, [
            () => examClassroomColl.deleteMany({ domainId }),
            () => examClassroomMigrationBatchColl.deleteMany({ domainIds: domainId }),
        ]);
    });
}

global.Hydro.model.examClassroom = { examClassroomColl, examClassroomMigrationBatchColl, examClassroomService };
