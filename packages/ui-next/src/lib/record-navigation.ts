import { teachPath, type TeachType } from '@hydrooj/common';

export function participantRecordsUrl(base: string, tid: string, uid: string | number, teachingType?: TeachType): string {
  const url = new URL(base, 'https://krypton.invalid');
  if (teachingType) {
    const prefix = url.pathname.replace(/\/record\/?$/, '');
    const target = new URL(`${prefix}${teachPath(teachingType, tid, 'records')}`, url.origin);
    target.searchParams.set('uidOrName', String(uid));
    return `${target.pathname}${target.search}`;
  }
  url.searchParams.set('tid', tid);
  url.searchParams.set('uidOrName', String(uid));
  return `${url.pathname}${url.search}`;
}
