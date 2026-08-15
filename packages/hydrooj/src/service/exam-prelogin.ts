import system from '../model/system';
import { ExamPreloginError, ExamPreloginService, examPreloginBatchColl, examPreloginTicketColl } from '../model/exam-prelogin';
import { dispatchExamPreloginOnVigil, retryExamPreloginOnVigil } from './vigil-bridge';

let instance: ExamPreloginService | null = null;
let instanceKey: string | null = null;

function configuredTicketKey(): string {
    const value = system.get('exam.preloginTicketKey');
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
        throw new ExamPreloginError('ticket_key_not_configured');
    }
    return value;
}

export function isExamPreloginWorkflowWriterEnabled(): boolean {
    const value = system.get('exam.preloginWorkflowWriterEnabled');
    if (value === undefined || value === null || value === false) return false;
    if (value !== true) throw new ExamPreloginError('workflow_writer_setting_invalid');
    return true;
}

export function isExamPreloginV2WriterEnabled(): boolean {
    const value = system.get('exam.preloginV2WriterEnabled');
    if (value === undefined || value === null || value === false) return false;
    if (value !== true) throw new ExamPreloginError('prelogin_v2_writer_setting_invalid');
    return true;
}

/**
 * Lazily initializes the P2.6 service after system settings are loaded.
 * A live key change is rejected because it would invalidate already-issued
 * five-minute tickets; apply the setting and restart after the drain window.
 */
export function getExamPreloginService(): ExamPreloginService {
    const key = configuredTicketKey();
    if (instance && instanceKey !== key) throw new ExamPreloginError('ticket_key_changed_restart_required');
    if (!instance) {
        instance = new ExamPreloginService(examPreloginBatchColl, examPreloginTicketColl, {
            ticketKey: key,
            dispatch: dispatchExamPreloginOnVigil,
            retry: retryExamPreloginOnVigil,
        });
        instanceKey = key;
    }
    return instance;
}
