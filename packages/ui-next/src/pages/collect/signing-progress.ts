export interface SigningProgressRow {
  studentRecordId: string;
  studentId: string;
  realName: string;
  uid: number | null;
  groupIds: string[];
  status: 'signed' | 'unsigned' | 'pending' | 'unbound';
  resignAllowed: boolean;
  signedAt: string | null;
  currentFileId: string | null;
}

export type SigningStatusFilter = 'all' | 'signed' | 'unsigned' | 'pending' | 'resign';
export type SigningBindingFilter = 'all' | 'bound' | 'unbound';

export function summarizeSigningProgress(rows: readonly SigningProgressRow[]) {
  const signed = rows.filter((row) => row.status === 'signed').length;
  return {
    total: rows.length,
    signed,
    unsigned: rows.length - signed,
    unboundUnsigned: rows.filter((row) => row.status !== 'signed' && row.uid === null).length,
  };
}

export function filterSigningProgress(
  rows: readonly SigningProgressRow[],
  query: string,
  status: SigningStatusFilter,
  binding: SigningBindingFilter,
  groupId = 'all',
) {
  const search = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (groupId !== 'all' && !row.groupIds.includes(groupId)) return false;
    if (search && !row.realName.toLowerCase().includes(search) && !row.studentId.toLowerCase().includes(search)) return false;
    if (status === 'signed' && row.status !== 'signed') return false;
    if (status === 'unsigned' && row.status === 'signed') return false;
    if (status === 'pending' && row.status !== 'pending') return false;
    if (status === 'resign' && !row.resignAllowed) return false;
    if (binding === 'bound' && row.uid === null) return false;
    if (binding === 'unbound' && row.uid !== null) return false;
    return true;
  });
}
