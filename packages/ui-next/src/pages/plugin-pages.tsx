import { useEffect } from 'react';
import { ChevronDown, Trophy, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';

// ─── Page-data payloads (produced server-side by the matching plugins) ─────

/** `fps-importer` FpsProblemImportHandler.get → listKnowledgeMapsForProblemSelection(). */
interface FpsImportPageData {
  knowledgeMaps?: Array<{ id: string; title: string }>;
}

/** `telegram` plugin login handler → `{ botLogin: config.botLogin }`. */
interface TelegramLoginPageData {
  botLogin?: string;
}

/** Global injected for the Telegram login widget's `data-onauth` callback. */
interface TelegramAuthWindow extends Window {
  onTelegramAuth?: (user: unknown) => void;
}

/** `scoreboard-xcpcio` display handler body for the `xcpcio_board.html` route. */
interface XcpcioBoardPageData {
  /** Content hash of the built `index-<hash>.js` bundle (absent until assets are built). */
  js?: string;
  /** Content hash of the built `index-<hash>.css` bundle. */
  css?: string;
  dataSource?: string;
  refreshInterval?: number;
  realtime?: boolean;
  tdoc?: { title?: string };
}

/** Globals read by the xcpcio board bundle at startup. */
interface XcpcioBoardWindow extends Window {
  CDN_HOST?: string;
  __toAssetUrl?: (url: string) => string;
  DATA_HOST?: string;
  DATA_REGION?: string;
  DEFAULT_LANG?: string;
  DATA_SOURCE?: string;
  REFRESH_INTERVAL?: number;
}

export function FpsImportPage() {
  const data = useBootstrap().page.data as FpsImportPageData;
  const knowledgeMaps: Array<{ id: string; title: string }> = data.knowledgeMaps || [];
  const defaultMapId = knowledgeMaps.length === 1 ? knowledgeMaps[0].id : '';
  return (
    <Page width="form">
      <PageHeader title="从 FPS 文件导入题目" />
      <Panel>
        <form method="post" encType="multipart/form-data" className="flex flex-col gap-5">
          <div className="rounded-lg border border-line bg-surface-sunken p-4">
            <label htmlFor="fps-file" className="text-sm font-medium text-fg">
              FPS / XML / ZIP 文件
            </label>
            <p className="mt-1 text-sm text-fg-muted">选择由 HUSTOJ/FPS 工具导出的题目包，系统会导入题面、标签、测试数据和题解。</p>
            <input
              id="fps-file"
              type="file"
              name="file"
              required
              className="mt-4 text-sm text-fg file:mr-3 file:rounded-md file:border-0 file:bg-surface-active file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-fg"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="fps-knowledge-map" className="text-sm font-medium text-fg">
              所属导图
            </label>
            <div className="relative">
              {/* ds-allow DS005: SimpleSelect 把空值写成隐藏域，required 不校验隐藏域，挡不住空的 knowledgeMapId；没有组件或 token 能保住这个原生必填选项。 */}
              <select
                id="fps-knowledge-map"
                name="knowledgeMapId"
                defaultValue={defaultMapId}
                required
                className="h-(--control-md) w-full appearance-none rounded-md border border-line-strong bg-surface pr-8 pl-2.5 text-sm text-fg shadow-xs outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-ring/40"
              >
                <option value="">请选择导图</option>
                {knowledgeMaps.map((map) => (
                  <option key={map.id} value={map.id}>
                    {map.title}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-fg-subtle" />
            </div>
            <p className="text-xs text-fg-subtle">导入题先保持隐藏，随后逐题选择同图知识节点。</p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              <Upload />
              上传并导入
            </Button>
          </div>
        </form>
      </Panel>
      <Panel title="导入说明">
        <div className="space-y-3 text-sm text-fg-muted">
          <p>大型 XML 会消耗较多内存；如果文件很大，建议先拆分题目包或移除测试数据后再分别上传。</p>
          <p>导入完成后会返回题库列表，你可以继续编辑题面、配置评测文件和补充标签。</p>
        </div>
      </Panel>
    </Page>
  );
}

export function TelegramLoginPage() {
  const bs = useBootstrap();
  const botLogin = (bs.page.data as TelegramLoginPageData).botLogin || '';

  useEffect(() => {
    if (!botLogin) return undefined;
    (window as TelegramAuthWindow).onTelegramAuth = (user: unknown) => {
      window.location.href = `/oauth/telegram/callback?payload=${encodeURIComponent(JSON.stringify(user))}`;
    };
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.dataset.telegramLogin = botLogin;
    script.dataset.size = 'large';
    script.dataset.onauth = 'onTelegramAuth(user)';
    script.dataset.requestAccess = 'write';
    document.getElementById('telegram-login-widget')?.appendChild(script);
    return () => {
      script.remove();
      delete (window as TelegramAuthWindow).onTelegramAuth;
    };
  }, [botLogin]);

  return (
    <Page width="form">
      <PageHeader title="使用 Telegram 登录" description="请在弹出的 Telegram 授权组件中确认身份。" />
      <Panel>
        <div id="telegram-login-widget" className="min-h-10 w-full min-w-0 overflow-x-auto" />
        {!botLogin ? <p className="mt-4 text-sm text-danger-fg">Telegram Bot 尚未配置。</p> : null}
      </Panel>
    </Page>
  );
}

export function XcpcioBoardPage() {
  const bs = useBootstrap();
  const data = bs.page.data as XcpcioBoardPageData;
  const scriptSrc = data.js ? `/assets/index-${data.js}.js` : '';
  const cssHref = data.css ? `/assets/index-${data.css}.css` : '';

  useEffect(() => {
    (window as XcpcioBoardWindow).CDN_HOST = '/';
    (window as XcpcioBoardWindow).__toAssetUrl = (url: string) => `/${url}`.replace(/\/+/g, '/');
    (window as XcpcioBoardWindow).DATA_HOST = '/';
    (window as XcpcioBoardWindow).DATA_REGION = 'Hydro';
    (window as XcpcioBoardWindow).DEFAULT_LANG = bs.locale?.startsWith('zh') ? 'zh-CN' : 'en';
    (window as XcpcioBoardWindow).DATA_SOURCE = data.dataSource || '';
    if (data.refreshInterval) (window as XcpcioBoardWindow).REFRESH_INTERVAL = data.refreshInterval;

    const created: HTMLElement[] = [];
    if (cssHref) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssHref;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
      created.push(link);
    }
    if (scriptSrc) {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = scriptSrc;
      script.crossOrigin = 'anonymous';
      document.body.appendChild(script);
      created.push(script);
    }
    return () => {
      created.forEach((node) => node.remove());
    };
  }, [bs.locale, cssHref, data.dataSource, data.refreshInterval, scriptSrc]);

  return (
    <Page width="full">
      <PageHeader
        title={(
          <span className="inline-flex min-w-0 items-center gap-2">
            <Trophy className="size-5 shrink-0 text-fg-subtle" aria-hidden="true" />
            <span className="min-w-0">XCPCIO 榜单</span>
          </span>
        )}
        description={`${data.tdoc?.title || '比赛榜单'} · 外榜视图`}
        actions={data.realtime ? <Badge tone="success">实时</Badge> : <Badge tone="info" dot>封榜/静态</Badge>}
      />
      {scriptSrc && cssHref ? (
        <div className="min-w-0 overflow-x-auto rounded-lg border border-line bg-surface">
          <div id="app" className="min-h-96" />
        </div>
      ) : (
        <Panel>
          <p className="text-sm text-fg-muted">
            榜单资源尚未准备好，请确认 scoreboard-xcpcio 静态资源已构建并复制到公开目录。
          </p>
        </Panel>
      )}
    </Page>
  );
}
