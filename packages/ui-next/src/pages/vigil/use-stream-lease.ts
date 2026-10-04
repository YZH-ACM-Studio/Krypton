/**
 * useStreamLease — watch lease for one live player.
 *
 * Opening calls watch. A non-empty lease renews after `renewAfterMs`.
 * Closing, unmount, or `pagehide` releases that lease and drops in-flight
 * results: a late watch is released, and a lost renew does not watch again.
 * A newer renew supersedes one already in flight, so a late response cannot
 * overwrite WatchState or start a second watch. Closing and retry clear
 * networkError before the next request settles. `actor` is read from a ref
 * so a new object does not restart the watch.
 */
import { useEffect, useRef, useState } from 'react';
import {
  releaseStudentStream,
  renewStudentStream,
  setManualRecording,
  VigilLeaseLostError,
  watchStudentStream,
  type VigilActor,
  type VigilWatchState,
} from '@/lib/vigil-api';

const NETWORK_ERROR = '与监考服务器的连接中断，正在重试…';
const RETRY_MS = 3_000;

export interface StreamLease {
  state: VigilWatchState | null;
  networkError: string | null;
  retry: () => void;
  setRecording: (enabled: boolean) => Promise<void>;
  recordingBusy: boolean;
}

export function useStreamLease(args: {
  open: boolean;
  contestId: string;
  machineId: string;
  actor: VigilActor;
}): StreamLease {
  const { open, contestId, machineId, actor } = args;
  const [state, setState] = useState<VigilWatchState | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [recordingBusy, setRecordingBusy] = useState(false);

  const actorRef = useRef(actor);
  const contestIdRef = useRef(contestId);
  const machineIdRef = useRef(machineId);
  const openRef = useRef(open);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const leaseIdRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);

  actorRef.current = actor;
  contestIdRef.current = contestId;
  machineIdRef.current = machineId;
  openRef.current = open;

  function clearTimer() {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function isActive(generation: number): boolean {
    return mountedRef.current && openRef.current && generationRef.current === generation;
  }

  function beginRequest(): number {
    requestRef.current += 1;
    return requestRef.current;
  }

  function isCurrent(generation: number, request: number): boolean {
    return isActive(generation) && requestRef.current === request;
  }

  function schedule(delayMs: number, generation: number, run: () => void) {
    clearTimer();
    if (!isActive(generation)) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!isActive(generation)) return;
      run();
    }, delayMs);
  }

  /** Drop a lease created by a request that lost the race with close, retry, or pagehide. */
  function releaseOrphan(leaseId: string) {
    if (leaseId === '' || leaseId === leaseIdRef.current) return;
    void releaseStudentStream(leaseId);
  }

  function adopt(next: VigilWatchState, generation: number) {
    if (!isActive(generation)) {
      releaseOrphan(next.leaseId);
      return;
    }
    leaseIdRef.current = next.leaseId;
    setState(next);
    setNetworkError(null);
    if (next.leaseId === '') {
      clearTimer();
      return;
    }
    schedule(next.renewAfterMs, generation, () => {
      void runRenew(next.leaseId, generation);
    });
  }

  async function runWatch(generation: number) {
    if (!isActive(generation)) return;
    try {
      const next = await watchStudentStream(
        contestIdRef.current,
        machineIdRef.current,
        actorRef.current,
      );
      adopt(next, generation);
    } catch {
      if (!isActive(generation)) return;
      setNetworkError(NETWORK_ERROR);
      schedule(RETRY_MS, generation, () => {
        void runWatch(generation);
      });
    }
  }

  async function runRenew(leaseId: string, generation: number) {
    if (!isActive(generation)) return;
    const request = beginRequest();
    try {
      const next = await renewStudentStream(leaseId);
      if (!isCurrent(generation, request)) {
        releaseOrphan(next.leaseId);
        return;
      }
      adopt(next, generation);
    } catch (error) {
      if (!isCurrent(generation, request)) return;
      if (error instanceof VigilLeaseLostError) {
        leaseIdRef.current = '';
        void runWatch(generation);
        return;
      }
      setNetworkError(NETWORK_ERROR);
      schedule(RETRY_MS, generation, () => {
        void runRenew(leaseId, generation);
      });
    }
  }

  function releaseCurrentLease() {
    clearTimer();
    const leaseId = leaseIdRef.current;
    leaseIdRef.current = '';
    generationRef.current += 1;
    if (leaseId !== '') void releaseStudentStream(leaseId);
  }

  function retry() {
    releaseCurrentLease();
    setState(null);
    setNetworkError(null);
    if (!mountedRef.current || !openRef.current) return;
    const generation = ++generationRef.current;
    void runWatch(generation);
  }

  async function setRecording(enabled: boolean): Promise<void> {
    setRecordingBusy(true);
    try {
      await setManualRecording(
        contestIdRef.current,
        machineIdRef.current,
        enabled,
        actorRef.current,
      );
    } catch (error) {
      if (mountedRef.current) setRecordingBusy(false);
      throw error;
    }
    if (!mountedRef.current) return;
    setRecordingBusy(false);
    if (!openRef.current) return;
    const leaseId = leaseIdRef.current;
    if (leaseId === '') return;
    const generation = generationRef.current;
    clearTimer();
    await runRenew(leaseId, generation);
  }

  useEffect(() => {
    mountedRef.current = true;
    if (!open) {
      setState(null);
      setNetworkError(null);
      return () => {
        mountedRef.current = false;
      };
    }
    const generation = ++generationRef.current;
    void runWatch(generation);
    return () => {
      mountedRef.current = false;
      releaseCurrentLease();
    };
  }, [open, contestId, machineId]);

  useEffect(() => {
    const onPageHide = () => {
      // Same boundary as close: drop the timer and generation so a fired renew
      // cannot watch again, and a watch still in flight is released on arrival.
      releaseCurrentLease();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  return {
    state,
    networkError,
    retry,
    setRecording,
    recordingBusy,
  };
}
