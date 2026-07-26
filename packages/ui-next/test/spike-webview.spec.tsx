import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpikeWebViewProbePage } from '../src/pages/spike-webview.tsx';

interface TestBridge {
  toWeb: { connect: (listener: (message: string) => void) => void };
  fromWeb: ReturnType<typeof vi.fn>;
  platformName: ReturnType<typeof vi.fn>;
}

afterEach(() => {
  delete window.QWebChannel;
  delete window.qt;
  document.querySelectorAll('script[src="qrc:///qtwebchannel/qwebchannel.js"]').forEach((script) => script.remove());
});

describe('webview spike probe', () => {
  it('reports a missing Qt script without enabling bridge controls', async () => {
    render(<SpikeWebViewProbePage />);

    const script = document.querySelector<HTMLScriptElement>('script[src="qrc:///qtwebchannel/qwebchannel.js"]');
    expect(script).not.to.equal(null);
    fireEvent.error(script!);

    expect(await screen.findByText(/failed to load qwebchannel\.js/)).not.to.equal(null);
    expect((screen.getByRole('button', { name: 'Ping C++' }) as HTMLButtonElement).disabled).to.equal(true);
    expect((screen.getByRole('button', { name: 'Read platform name' }) as HTMLButtonElement).disabled).to.equal(true);
  });

  it('reports a missing transport when the constructor exists outside the Qt host', async () => {
    const constructor = vi.fn();
    window.QWebChannel = constructor as unknown as NonNullable<Window['QWebChannel']>;

    render(<SpikeWebViewProbePage />);

    expect(await screen.findByText(/window\.qt\.webChannelTransport not present/)).not.to.equal(null);
    expect(constructor).not.toHaveBeenCalled();
  });

  it('connects the host bridge and exposes bidirectional controls', async () => {
    let receiveFromHost: ((message: string) => void) | undefined;
    const bridge: TestBridge = {
      toWeb: {
        connect(listener) {
          receiveFromHost = listener;
        },
      },
      fromWeb: vi.fn(),
      platformName: vi.fn().mockResolvedValue('macOS-arm64'),
    };
    const constructorSpy = vi.fn();
    class TestQWebChannel {
      constructor(transport: unknown, callback: (channel: { objects: { bridge: TestBridge } }) => void) {
        constructorSpy(transport);
        callback({ objects: { bridge } });
      }
    }
    window.qt = { webChannelTransport: { channel: 'test' } };
    window.QWebChannel = TestQWebChannel as unknown as NonNullable<Window['QWebChannel']>;
    const user = userEvent.setup();

    render(<SpikeWebViewProbePage />);

    expect(await screen.findByText(/channel connected/)).not.to.equal(null);
    expect(constructorSpy).toHaveBeenCalledOnce();
    expect((screen.getByRole('button', { name: 'Ping C++' }) as HTMLButtonElement).disabled).to.equal(false);

    await user.click(screen.getByRole('button', { name: 'Ping C++' }));
    expect(bridge.fromWeb).toHaveBeenCalledWith('ping');
    expect(screen.getByText(/→ ping/)).not.to.equal(null);

    receiveFromHost?.('pong from native');
    expect(await screen.findByText(/← pong from native/)).not.to.equal(null);

    await user.click(screen.getByRole('button', { name: 'Read platform name' }));
    await waitFor(() => expect(bridge.platformName).toHaveBeenCalledOnce());
    expect(await screen.findByText(/host platform:/)).not.to.equal(null);
    expect(screen.getByText('macOS-arm64')).not.to.equal(null);
    expect(screen.getByText(/platformName\(\) = macOS-arm64/)).not.to.equal(null);
  });
});
