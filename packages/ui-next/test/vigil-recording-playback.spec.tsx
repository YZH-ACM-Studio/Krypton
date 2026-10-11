import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VigilRecording, VigilStudentCard } from '../src/lib/vigil-api';
import { RecordingPlaybackDialog } from '../src/pages/vigil/recording-playback-dialog';

const { listContestRecordings, probeRecordingDuration } = vi.hoisted(() => ({
  listContestRecordings: vi.fn<() => Promise<VigilRecording[]>>(),
  probeRecordingDuration: vi.fn<(url: string) => Promise<number>>(),
}));

vi.mock('@/lib/vigil-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/vigil-api')>(),
  listContestRecordings,
}));
vi.mock('@/pages/vigil/recording-timeline', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/pages/vigil/recording-timeline')>(),
  probeRecordingDuration,
}));
vi.mock('@/lib/bootstrap', () => ({ useBootstrap: () => ({ user: { id: 1, name: 'Test' } }) }));

const student: VigilStudentCard = {
  machineId: 'machine', examSessionId: 'session', uid: 7,
  name: 'Test student', status: 'ended', eventCount: 0,
};

function recording(id: string, start: string, durationMs: number): VigilRecording {
  return {
    recordingId: id, machineId: 'machine', uid: 7, streamType: 'screen',
    filename: `${id}.mp4`, url: `/${id}.mp4`, size: 100, durationMs,
    startTs: start, endTs: '2026-10-11T13:00:00',
  };
}

function openPlayback() {
  return render(<RecordingPlaybackDialog open onOpenChange={vi.fn()} contestId="test" student={student} />);
}

describe('recording playback timeline', () => {
  beforeEach(() => {
    listContestRecordings.mockReset();
    probeRecordingDuration.mockReset();
  });

  it('refreshes recordings when switching students instead of reporting camera absent from an old snapshot', async () => {
    const oldCamera = { ...recording('old-camera', '2026-10-11T10:00:00', 3000), streamType: 'camera' as const };
    let finish!: (rows: VigilRecording[]) => void;
    listContestRecordings.mockResolvedValueOnce([oldCamera]);
    listContestRecordings.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = openPlayback();
    await waitFor(() => expect(screen.queryByText('加载录屏列表…')).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: /摄像头/ }));
    await screen.findByRole('slider');
    const nextStudent = { ...student, uid: 8, machineId: 'second-machine', examSessionId: 'second-session' };
    view.rerender(<RecordingPlaybackDialog open onOpenChange={vi.fn()} contestId="test" student={nextStudent} />);
    expect(listContestRecordings).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/此学生在当前比赛暂无/)).toBeNull();
    await act(async () => finish([{ ...oldCamera, recordingId: 'new-camera', filename: 'new-camera.mp4', url: '/new-camera.mp4', uid: 8 }]));
    await screen.findByRole('slider');
    expect(document.querySelector('video')).toHaveAttribute('src', '/vigil-hls/recordings/new-camera.mp4');
  });

  it('does not let a late list for the previous selection hide the current camera recordings', async () => {
    let finishOld!: (rows: VigilRecording[]) => void;
    listContestRecordings.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve; }));
    const camera = { ...recording('camera', '2026-10-11T10:00:00', 3000), uid: 8, streamType: 'camera' as const };
    listContestRecordings.mockResolvedValueOnce([camera]);
    const view = openPlayback();
    view.rerender(<RecordingPlaybackDialog open onOpenChange={vi.fn()} contestId="test" student={{ ...student, uid: 8 }} />);
    fireEvent.click(screen.getByRole('tab', { name: /摄像头/ }));
    await screen.findByRole('slider');
    await act(async () => finishOld([]));
    expect(document.querySelector('video')).toHaveAttribute('src', '/vigil-hls/recordings/camera.mp4');
    expect(screen.queryByText(/暂无/)).toBeNull();
  });

  it('shows list failures instead of no camera, and allows an explicit refresh', async () => {
    listContestRecordings.mockRejectedValueOnce(new Error('录像读取失败'));
    listContestRecordings.mockResolvedValueOnce([{ ...recording('camera', '2026-10-11T10:00:00', 3000), streamType: 'camera' as const }]);
    openPlayback();
    fireEvent.click(screen.getByRole('tab', { name: /摄像头/ }));
    expect(await screen.findByText('录像读取失败')).toBeInTheDocument();
    expect(screen.queryByText(/此学生在当前比赛暂无/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '刷新录像' }));
    await screen.findByRole('slider');
    expect(document.querySelector('video')).toHaveAttribute('src', '/vigil-hls/recordings/camera.mp4');
  });

  it('seeks across recordings using media durations, without adding the wall-clock gap', async () => {
    listContestRecordings.mockResolvedValue([
      recording('second', '2026-10-11T12:00:00', 5000),
      recording('first', '2026-10-11T10:00:00', 3000),
    ]);
    openPlayback();
    const slider = await screen.findByRole('slider');
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'));
    expect(slider).toHaveAttribute('aria-valuemax', '8');
    expect(screen.getByText(/2 段 · 累计播放时长/)).toBeInTheDocument();
    expect(probeRecordingDuration).not.toHaveBeenCalled();
    fireEvent.keyDown(slider, { key: 'End' });
    const video = document.querySelector('video');
    expect(video).toHaveAttribute('src', '/vigil-hls/recordings/second.mp4');
    if (!video) throw new Error('Playback video missing');
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(5);
  });

  it('shows failed legacy metadata reads, disables incomplete seeking and allows retry', async () => {
    listContestRecordings.mockResolvedValue([
      recording('legacy', '2026-10-11T10:00:00', 0),
    ]);
    probeRecordingDuration.mockRejectedValueOnce(new Error('无法读取录像时长'));
    probeRecordingDuration.mockResolvedValueOnce(7600.933);
    openPlayback();
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取录像时长');
    expect(screen.getByText(/历史录像缺少起止时间元数据/)).toBeInTheDocument();
    const slider = screen.getByRole('slider');
    expect(slider).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(slider).toHaveAttribute('aria-disabled', 'false'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(slider).toHaveAttribute('aria-valuemax', '7601');
    expect(probeRecordingDuration).toHaveBeenCalledTimes(2);
  });
});
