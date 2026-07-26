// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { translateEventType, translateSeverity } from '../src/pages/vigil/i18n.ts';

describe('vigil event-type translation', () => {
  it('translates known detection, telemetry, and lifecycle tokens', () => {
    expect(translateEventType('process_started_unauthorized')).to.equal('未授权进程启动');
    expect(translateEventType('usb_storage_changed')).to.equal('USB 存储设备插拔');
    expect(translateEventType('window.foreground_changed')).to.equal('前台窗口切换');
    expect(translateEventType('telemetry.screenshot_failed')).to.equal('截屏失败');
    expect(translateEventType('network.blocked_navigation')).to.equal('已拦截导航');
    expect(translateEventType('ffmpeg_missing')).to.equal('ffmpeg 缺失');
  });

  it('maps both spellings of the disconnect event to the same label', () => {
    expect(translateEventType('client.disconnected')).to.equal('客户端已断开');
    expect(translateEventType('client_disconnected')).to.equal('客户端已断开');
  });

  it('falls back to a fixed label for missing tokens', () => {
    expect(translateEventType(null)).to.equal('未知事件');
    expect(translateEventType(undefined)).to.equal('未知事件');
    expect(translateEventType('')).to.equal('未知事件');
  });

  it('humanises unknown tokens instead of throwing', () => {
    expect(translateEventType('foo.bar_baz')).to.equal('foo bar baz');
    expect(translateEventType('weird__mix..of_separators')).to.equal('weird mix of separators');
    expect(translateEventType('plainword')).to.equal('plainword');
  });

  it('is case-sensitive for the lookup, so casing variants degrade to humanised text', () => {
    expect(translateEventType('Camera_Lost')).to.equal('Camera Lost');
  });
});

describe('vigil severity translation', () => {
  it('translates every documented severity level', () => {
    expect(translateSeverity('info')).to.equal('提示');
    expect(translateSeverity('low')).to.equal('低');
    expect(translateSeverity('medium')).to.equal('中');
    expect(translateSeverity('warning')).to.equal('警告');
    expect(translateSeverity('high')).to.equal('高');
    expect(translateSeverity('error')).to.equal('错误');
    expect(translateSeverity('critical')).to.equal('严重');
  });

  it('normalises casing before the lookup', () => {
    expect(translateSeverity('CRITICAL')).to.equal('严重');
    expect(translateSeverity('Warning')).to.equal('警告');
  });

  it('defaults missing severities to info', () => {
    expect(translateSeverity(null)).to.equal('提示');
    expect(translateSeverity(undefined)).to.equal('提示');
    expect(translateSeverity('')).to.equal('提示');
  });

  it('passes unknown severities through verbatim with the original casing', () => {
    expect(translateSeverity('fatal')).to.equal('fatal');
    expect(translateSeverity('FATAL')).to.equal('FATAL');
  });
});
