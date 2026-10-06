import { useEffect, useState, type JSX } from 'react';
import { loadDomainUsersByIds, type DomainUserOption } from '@/components/domain-user-search';

export type UserNames = ReadonlyMap<number, string>;

const EMPTY_NAMES: UserNames = new Map<number, string>();

function requestedIds(uids: ReadonlyArray<number | null | undefined>): number[] {
  const unique = new Set<number>();
  for (const uid of uids) {
    if (typeof uid === 'number' && Number.isSafeInteger(uid) && uid > 0) unique.add(uid);
  }
  return [...unique].sort((left, right) => left - right);
}

function namesFromUsers(users: readonly DomainUserOption[]): UserNames {
  const names = new Map<number, string>();
  for (const user of users) {
    const name = user.displayName || user.uname;
    if (name) names.set(user._id, name);
  }
  return names.size === 0 ? EMPTY_NAMES : names;
}

/**
 * Resolve positive safe-integer UIDs once per domain and id set.
 * A cancelled request must not write after unmount or a key change.
 */
export function useUserNames(domainId: string, uids: ReadonlyArray<number | null | undefined>): UserNames {
  const key = requestedIds(uids).join(',');
  const [loaded, setLoaded] = useState<{ domainId: string; key: string; names: UserNames }>({
    domainId: '',
    key: '',
    names: EMPTY_NAMES,
  });

  useEffect(() => {
    if (key === '') return undefined;
    let cancelled = false;
    const ids = key.split(',').map((part) => Number(part));
    const settle = (names: UserNames) => {
      if (!cancelled) setLoaded({ domainId, key, names });
    };
    try {
      void loadDomainUsersByIds(domainId, ids).then(
        (users) => {
          settle(namesFromUsers(users));
        },
        () => {
          settle(EMPTY_NAMES);
        },
      );
    } catch {
      settle(EMPTY_NAMES);
    }
    return () => {
      cancelled = true;
    };
  }, [domainId, key]);

  if (key === '' || loaded.domainId !== domainId || loaded.key !== key) return EMPTY_NAMES;
  return loaded.names;
}

export function userDisplayName(uid: number | null | undefined, names: UserNames): string {
  if (uid == null) return '—';
  const name = names.get(uid);
  // An empty string is a stored name, not a miss.
  if (name !== undefined) return name;
  return `UID ${uid}`;
}

export function UserLabel({
  uid,
  names,
}: {
  uid: number | null | undefined;
  names: UserNames;
}): JSX.Element {
  return <span title={uid == null ? undefined : `UID ${uid}`}>{userDisplayName(uid, names)}</span>;
}
