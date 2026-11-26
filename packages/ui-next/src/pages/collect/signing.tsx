import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Bell, ExternalLink, FileDown, Upload, X } from 'lucide-react';
import { ModuleWorkspace } from '@/components/management/module-workspace';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable } from '@/components/ui/data-table';
import { DateTime } from '@/components/ui/datetime';
import { Stat } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { confirmDialog } from '@/components/ui/dialog';
import { FormField, FormRow } from '@/components/ui/form';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { PageTabs } from '@/components/ui/page-tabs';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { TableAction, TableActions } from '@/components/ui/table-actions';
import { Input, SearchInput } from '@/components/ui/input';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { downloadZip } from '@/lib/download-zip';
import { createSigningAttemptId } from './signing-attempt-id';
import { SignaturePad } from './signature-pad';
import { readSigningPdfText, signingPdfOutputScale } from './signing-pdf-reader';
import {
  filterSigningProgress,
  summarizeSigningProgress,
  type SigningBindingFilter,
  type SigningProgressRow,
  type SigningStatusFilter,
} from './signing-progress';

type FieldKind = 'studentId' | 'realName' | 'signedAt' | 'signature';
interface Field {
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}
const labels: Record<FieldKind, string> = { studentId: '学号', realName: '姓名', signedAt: '签署时间', signature: '手写签名' };
const kinds = Object.keys(labels) as FieldKind[];
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const time = (value: string | null | undefined) => (value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—');

async function post(url: string, body: Record<string, unknown> | FormData) {
  const response = await fetchHydroResponse(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: body instanceof FormData ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readHydroResponseError(response, '操作失败，请重试'));
  return response;
}

function PdfPage({
  document,
  number,
  width,
  fields,
  onMark,
  kind,
  onReady,
}: {
  document: PDFDocumentProxy;
  number: number;
  width: number;
  fields: Field[];
  onMark?: (field: Field) => void;
  kind?: FieldKind;
  onReady?: (number: number, ready: boolean, failed: boolean) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [textReady, setTextReady] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [displayScale, setDisplayScale] = useState(() => ({ ratio: window.devicePixelRatio || 1, pinch: window.visualViewport?.scale || 1 }));
  const start = useRef<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  useEffect(() => {
    let active = true;
    document
      .getPage(number)
      .then((next) => {
        if (active) setPage(next);
      })
      .catch((err: unknown) => {
        if (active) setError(message(err));
      });
    return () => {
      active = false;
    };
  }, [document, number]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '600px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!page) return;
    const natural = page.getViewport({ scale: 1 });
    setViewport(page.getViewport({ scale: width / natural.width }));
  }, [page, width]);
  useEffect(() => {
    const update = () => setDisplayScale({ ratio: window.devicePixelRatio || 1, pinch: window.visualViewport?.scale || 1 });
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);
  useEffect(() => {
    onReady?.(number, rendered && textReady, !!error);
  }, [number, rendered, textReady, error, onReady]);
  useEffect(() => {
    if (!page || !visible) return;
    let active = true;
    readSigningPdfText(page.streamTextContent())
      .then((content) => {
        if (active) {
          setText(content);
          setTextReady(true);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          console.error('[collect-signing] pdf-text-failed', { page: number, error: message(err) });
          setError(message(err));
        }
      });
    return () => {
      active = false;
    };
  }, [page, visible, number]);
  useEffect(() => {
    if (!page || !viewport || !canvas.current || !visible) return;
    const element = canvas.current;
    const ratio = signingPdfOutputScale(viewport.width, viewport.height, displayScale.ratio, displayScale.pinch);
    // 已成功展示过的页面不会因离屏取消重绘而重新阻止签署；真实渲染错误仍单独禁签。
    element.width = Math.ceil(viewport.width * ratio);
    element.height = Math.ceil(viewport.height * ratio);
    const task = page.render({ canvas: element, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
    let active = true;
    task.promise
      .then(() => {
        if (active) setRendered(true);
      })
      .catch((err: unknown) => {
        if (active) {
          console.error('[collect-signing] pdf-render-failed', { page: number, error: message(err) });
          setError(message(err));
        }
      });
    return () => {
      active = false;
      task.cancel();
      element.width = 1;
      element.height = 1;
    };
  }, [page, viewport, visible, displayScale, number]);
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)) };
  };
  return (
    <div className="mb-5">
      <p className="mb-2 text-center text-xs text-fg-muted">第 {number} 页</p>
      {error && (
        <p role="alert" className="text-danger-fg">
          文档显示失败：{error}
        </p>
      )}
      <div
        ref={container}
        className="relative bg-white shadow-sm"
        style={{ width, height: viewport?.height || width * 1.414, touchAction: onMark ? 'none' : 'auto' }}
        onPointerDown={
          onMark
            ? (event) => {
                if (!event.isPrimary) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                start.current = point(event);
                setDrag(null);
              }
            : undefined
        }
        onPointerMove={
          onMark
            ? (event) => {
                if (!start.current) return;
                const end = point(event);
                setDrag({
                  x: Math.min(start.current.x, end.x),
                  y: Math.min(start.current.y, end.y),
                  width: Math.abs(end.x - start.current.x),
                  height: Math.abs(end.y - start.current.y),
                });
              }
            : undefined
        }
        onPointerCancel={() => {
          start.current = null;
          setDrag(null);
        }}
        onPointerUp={
          onMark
            ? (event) => {
                if (!start.current || !viewport || !kind) return;
                const end = point(event);
                const begin = start.current;
                start.current = null;
                setDrag(null);
                if (Math.abs(begin.x - end.x) < 8 || Math.abs(begin.y - end.y) < 8) return;
                const a = viewport.convertToPdfPoint(begin.x, begin.y);
                const b = viewport.convertToPdfPoint(end.x, end.y);
                onMark({
                  kind,
                  page: number,
                  x: Math.min(a[0], b[0]),
                  y: Math.min(a[1], b[1]),
                  width: Math.abs(a[0] - b[0]),
                  height: Math.abs(a[1] - b[1]),
                  fontSize: 12,
                });
              }
            : undefined
        }
      >
        <canvas ref={canvas} className="block h-full w-full" aria-label={`知情书第 ${number} 页`} />
        <span className="sr-only">{text}</span>
        {viewport &&
          fields
            .filter((field) => field.page === number)
            .map((field, index) => {
              const rect = viewport.convertToViewportRectangle([field.x, field.y, field.x + field.width, field.y + field.height]);
              return (
                <div
                  key={index}
                  className="pointer-events-none absolute border-2 border-brand bg-brand-soft text-xs text-brand-fg"
                  style={{
                    left: Math.min(rect[0], rect[2]),
                    top: Math.min(rect[1], rect[3]),
                    width: Math.abs(rect[2] - rect[0]),
                    height: Math.abs(rect[3] - rect[1]),
                  }}
                >
                  {labels[field.kind]}
                </div>
              );
            })}
        {drag && (
          <div
            className="pointer-events-none absolute border-2 border-brand bg-brand-soft"
            style={{ left: drag.x, top: drag.y, width: drag.width, height: drag.height }}
          />
        )}
      </div>
    </div>
  );
}

export function SigningPdfViewer({
  url,
  fields = [],
  onMark,
  kind,
  onReady,
}: {
  url: string;
  fields?: Field[];
  onMark?: (field: Field) => void;
  kind?: FieldKind;
  onReady?: (ready: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const pageReadiness = useRef(new Map<number, { ready: boolean; failed: boolean }>());
  const pageReady = useCallback(
    (number: number, ready: boolean, failed: boolean) => {
      pageReadiness.current.set(number, { ready, failed });
      onReady?.(pageReadiness.current.get(1)?.ready === true && ![...pageReadiness.current.values()].some((page) => page.failed));
    },
    [onReady],
  );
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width - 16)));
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true;
    let destroy: (() => Promise<void>) | undefined;
    setDocument(null);
    pageReadiness.current.clear();
    setError('');
    onReady?.(false);
    import('pdfjs-dist/legacy/build/pdf.mjs')
      .then(async (pdfjs) => {
        if (!active) return;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const assetBase = import.meta.env.DEV ? '/next/node_modules/pdfjs-dist/' : import.meta.env.BASE_URL;
        const task = pdfjs.getDocument({
          url,
          withCredentials: true,
          isEvalSupported: false,
          enableXfa: false,
          maxImageSize: 16000000,
          cMapUrl: `${assetBase}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${assetBase}standard_fonts/`,
          wasmUrl: `${assetBase}wasm/`,
        });
        destroy = () => task.destroy();
        const loaded = await task.promise;
        if (active) {
          setDocument(loaded);
        }
      })
      .catch((err: unknown) => {
        if (active) setError(message(err));
      });
    return () => {
      active = false;
      void destroy?.();
    };
  }, [url, onReady]);
  return (
    <div ref={host} className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-2 text-sm">
        <span>{document ? `共 ${document.numPages} 页` : '正在读取文档…'}</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => setZoom(Math.max(1, zoom - 0.5))} disabled={zoom <= 1} aria-label="缩小文档">
            −
          </Button>
          <span className="tabular">{Math.round(zoom * 100)}%</span>
          <Button size="sm" variant="secondary" onClick={() => setZoom(Math.min(4, zoom + 0.5))} disabled={zoom >= 4} aria-label="放大文档">
            ＋
          </Button>
        </div>
      </div>
      <p className="mb-3 text-xs text-fg-subtle">文字较小时可点 ＋ 放大，放大后左右滑动查看。</p>
      {error ? (
        <p role="alert" className="rounded-lg border border-danger-line p-4 text-danger-fg">
          文档加载失败：{error}。请刷新重试。
        </p>
      ) : (
        <div className="max-w-full overflow-x-auto bg-surface-sunken p-2">
          {document &&
            Array.from({ length: document.numPages }, (_, i) => (
              <PdfPage
                key={`${url}:${i}`}
                document={document}
                number={i + 1}
                width={width * zoom}
                fields={fields}
                onMark={onMark}
                kind={kind}
                onReady={pageReady}
              />
            ))}
        </div>
      )}
    </div>
  );
}

interface SignPageData {
  request: { id: string; title: string; dueAt: string; status: string };
  mode: 'ready' | 'preview' | 'closed' | 'outside' | 'signed';
  sourceUrl?: string;
  manageUrl?: string;
  signedAt?: string;
  pendingAttemptId?: string;
  generation?: number;
  reopened?: boolean;
  identity?: { studentId: string; realName: string };
}

export function CollectSigningPage() {
  const data = useBootstrap().page.data as SignPageData;
  const canvas = useRef<HTMLCanvasElement>(null);
  const attempt = useRef<string | null>(data.pendingAttemptId || null);
  const signature = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [signed, setSigned] = useState(data.mode === 'signed');
  const [preview, setPreview] = useState('');
  const [ink, setInk] = useState(false);
  const [documentReady, setDocumentReady] = useState(false);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      if (!data.pendingAttemptId && !attempt.current) {
        const element = canvas.current;
        const pixels = element?.getContext('2d')?.getImageData(0, 0, element.width, element.height).data;
        if (!element || !pixels) throw new Error('浏览器无法读取签名，请刷新后重试');
        let minX = element.width;
        let maxX = -1;
        let minY = element.height;
        let maxY = -1;
        let count = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] <= 64 || Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >= 200) continue;
          const x = (i / 4) % element.width;
          const y = Math.floor(i / 4 / element.width);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          count++;
        }
        if (count < 40 || maxX - minX < 12 || maxY - minY < 6) throw new Error('请在签名框内写下完整姓名');
      }
      if (data.mode === 'preview') {
        const response = await post(`${data.manageUrl}/preview`, { signature: canvas.current?.toDataURL('image/png') });
        setPreview(URL.createObjectURL(await response.blob()));
      } else {
        attempt.current ||= createSigningAttemptId();
        if (!data.pendingAttemptId) signature.current ||= canvas.current?.toDataURL('image/png') || null;
        await post(window.location.pathname, {
          attemptId: attempt.current,
          generation: data.generation,
          ...(data.pendingAttemptId ? {} : { signature: signature.current }),
        });
        setSigned(true);
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page width="wide">
      <PageHeader
        title={data.request.title}
        description="实验室安全 · 知情书签署"
        meta={
          <>
            截止时间：
            <DateTime value={data.request.dueAt} mode="datetime" />
          </>
        }
      />
      {signed ? (
        <Panel>
          <div className="space-y-3 py-8 text-center">
            <h2 className="text-xl font-semibold">签署成功，已归档</h2>
            <p>你的知情书已经提交，无需再次操作。</p>
            {data.signedAt && <p className="text-sm text-fg-muted">{time(data.signedAt)}</p>}
          </div>
        </Panel>
      ) : data.mode === 'closed' || data.mode === 'outside' ? (
        <Panel>
          <div className="py-8">
            <h2 className="text-lg font-semibold">{data.mode === 'closed' ? '签署已结束' : '当前身份不在本次签署名单中'}</h2>
            <p className="mt-2 text-fg-muted">如需签署，请联系管理员核对名单和开放时间。</p>
          </div>
        </Panel>
      ) : (
        <>
          {data.mode === 'preview' && (
            <Alert
              tone="info"
              title="管理员预览"
              action={
                <Button asChild variant="link" size="sm">
                  <a href={data.manageUrl}>管理此活动</a>
                </Button>
              }
            >
              可以试写和查看效果，不会产生学生签署记录。
            </Alert>
          )}
          {data.reopened && <Alert tone="info">管理员已允许重新签署；本次成功后更新归档，原签署记录保留。</Alert>}
          <div className="space-y-6">
            <div className="min-w-0">
              {data.sourceUrl ? (
                <SigningPdfViewer url={preview || data.sourceUrl} onReady={setDocumentReady} />
              ) : (
                <Alert tone="info">请先在管理页上传知情书。</Alert>
              )}
            </div>
            <Panel title="阅读知情书后签署">
              <div className="space-y-4">
                {data.identity && (
                  <p className="rounded-md bg-surface-sunken p-3">
                    {data.identity.realName} <span className="ml-2 text-fg-muted">{data.identity.studentId}</span>
                    <span className="mt-1 block text-xs text-fg-muted">身份来自已绑定花名册。如有错误，请联系管理员。</span>
                  </p>
                )}
                {data.pendingAttemptId ? (
                  <p>上次签署尚未完成归档。笔迹已保留，点击下方按钮继续即可。</p>
                ) : (
                  <SignaturePad canvasRef={canvas} disabled={busy || !documentReady || !!attempt.current} onChange={setInk} />
                )}
                {error && (
                  <p role="alert" className="text-sm text-danger-fg">
                    {error}
                  </p>
                )}
                <p className="text-sm text-fg-muted">提交签署即表示你已阅读知情书，并确认使用本人手写签名。</p>
                <Button
                  className="w-full"
                  variant="primary"
                  disabled={busy || !documentReady || !data.sourceUrl || (!ink && !data.pendingAttemptId)}
                  onClick={() => void submit()}
                >
                  {busy ? '正在生成并归档…' : data.mode === 'preview' ? '预览签署效果' : attempt.current ? '继续完成签署' : '提交签署'}
                </Button>
                <p className="text-center text-xs text-fg-muted">看到“签署成功，已归档”后即可关闭页面。</p>
              </div>
            </Panel>
          </div>
        </>
      )}
    </Page>
  );
}

interface AdminData {
  canEdit: boolean;
  schools: Array<{ id: string; name: string }>;
  groups: Array<{ id: string; schoolId: string; name: string }>;
  request: {
    id: string;
    title: string;
    description: string;
    status: string;
    revision: number;
    schoolId: string;
    groupIds: string[];
    collaboratorUids: number[];
    dueAt: string;
    publishedAt: string | null;
  } | null;
  document: { fields: Field[]; confirmed: boolean; name: string } | null;
  signUrl: string | null;
  sourceUrl: string | null;
  fileBaseUrl: string | null;
  progress: {
    rows: SigningProgressRow[];
    files: Array<{
      fileId: string;
      filename: string;
      studentRecordId: string;
      studentId: string;
      realName: string;
      signedAt: string;
      version: number;
      current: boolean;
      left: boolean;
    }>;
  };
}

export function AdminCollectSigningPage() {
  const data = useBootstrap().page.data as AdminData;
  const [school, setSchool] = useState(data.request?.schoolId || data.schools[0]?.id || '');
  const [fields, setFields] = useState<Field[]>(data.document?.fields || []);
  const [kind, setKind] = useState<FieldKind>('studentId');
  const [marking, setMarking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const draft = !data.request?.publishedAt && data.request?.status === 'draft';
  const fieldsDirty = JSON.stringify(fields) !== JSON.stringify(data.document?.fields || []);
  const [tab, setTab] = useState<'settings' | 'document' | 'progress'>(!data.request ? 'settings' : draft ? 'document' : 'progress');
  const sourceFile = useRef<HTMLInputElement>(null);
  const [sourceName, setSourceName] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SigningStatusFilter>('all');
  const [bindingFilter, setBindingFilter] = useState<SigningBindingFilter>('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const signingGroups = data.groups.filter((group) => data.request?.groupIds.includes(group.id));
  const summary = summarizeSigningProgress(data.progress.rows);
  const filteredRows = filterSigningProgress(data.progress.rows, search, statusFilter, bindingFilter, groupFilter);
  const hasFilters = !!search.trim() || statusFilter !== 'all' || bindingFilter !== 'all' || groupFilter !== 'all';
  const url = window.location.pathname;
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const action = async (operation: string, extra: Record<string, unknown> | FormData = {}) => {
    setBusy(true);
    setError('');
    try {
      const body = extra instanceof FormData ? extra : { operation, revision: data.request?.revision, ...extra };
      const response = await post(url, body);
      if (operation === 'copy') {
        const result = (await response.json()) as { redirect: string };
        window.location.assign(result.redirect);
      } else window.location.reload();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  };
  const showPreview = async () => {
    setBusy(true);
    setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 180;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('浏览器无法创建签名预览');
      ctx.font = '52px sans-serif';
      ctx.fillText('签名示例', 30, 100);
      const response = await post(`${url}/preview`, { fields, signature: canvas.toDataURL('image/png') });
      setPreview(URL.createObjectURL(await response.blob()));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  const pack = async (history: boolean, filtered = false) => {
    setBusy(true);
    setError('');
    try {
      const rows = filtered ? filteredRows : data.progress.rows;
      const studentIds = new Set(rows.map((row) => row.studentRecordId));
      const files = data.progress.files.filter((file) => (history || file.current) && (!filtered || studentIds.has(file.studentRecordId)));
      const lists: [string, AdminData['progress']['rows']][] = [
        ['全部名单', rows],
        ['未签署', rows.filter((row) => row.status !== 'signed')],
        ['待绑定', rows.filter((row) => row.status !== 'signed' && row.uid === null)],
      ];
      await downloadZip(`${data.request?.title || '知情书'}${filtered ? '-筛选结果' : history ? '-全部版本' : '-当前签署'}.zip`, [
        { name: '签署清单.json', content: JSON.stringify({ activity: data.request?.title, students: rows, files }, null, 2) },
        ...lists.map(([name, listRows]) => ({
          name: `${name}.csv`,
          content: `\uFEFF${[
            ['学号', '姓名', '状态', '账号绑定', '签署时间'],
            ...listRows.map((row) => [
              row.studentId,
              row.realName,
              row.status === 'signed'
                ? row.resignAllowed
                  ? '已签署，可重签'
                  : '已签署'
                : row.status === 'unbound'
                  ? '未绑定账号'
                  : row.status === 'pending'
                    ? '待完成归档'
                    : '未签署',
              row.uid === null ? '未绑定账号' : '已绑定账号',
              time(row.signedAt),
            ]),
          ]
            .map((cells) =>
              cells
                .map(
                  (value) =>
                    `"${String(value)
                      .replace(/^[=+\-@\t\r]/, "'$&")
                      .replace(/"/g, '""')}"`,
                )
                .join(','),
            )
            .join('\r\n')}`,
        })),
        ...files.map((file) => ({
          name: `${file.left ? '已离组/' : ''}${file.studentRecordId}/${file.filename}`,
          url: `${data.fileBaseUrl}${file.fileId}`,
        })),
      ]);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  const due = data.request?.dueAt
    ? new Date(new Date(data.request.dueAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : '';
  return (
    <ModuleWorkspace
      moduleTitle="文件收集"
      title={data.request ? data.request.title : '新建文档签署'}
      description="上传知情书，标定原文位置，再发布签署链接。"
      navItems={[]}
      hideNav
      bypassPrivGate
      actions={
        <Button asChild variant="secondary">
          <a href="/admin/collect">
            <ArrowLeft />
            返回列表
          </a>
        </Button>
      }
    >
      {error && (
        <Alert tone="danger" title="操作失败">
          {error}
        </Alert>
      )}
      {busy && <Alert tone="info">正在处理，请稍候…</Alert>}
      {data.request && (
        <div className="border-b border-line">
          <PageTabs
            value={tab}
            onValueChange={setTab}
            aria-label="文档签署管理"
            items={[
              { value: 'progress', label: '签署进度', count: summary.signed },
              { value: 'document', label: '知情书与位置' },
              ...(data.canEdit ? [{ value: 'settings' as const, label: '活动设置' }] : []),
            ]}
          />
        </div>
      )}
      {data.canEdit && (
        <div hidden={tab !== 'settings'}>
          <form method="post">
            <Panel
              title="活动设置"
              footer={
                <div className="flex justify-end">
                  <Button type="submit" variant="primary" disabled={busy}>
                    保存活动设置
                  </Button>
                </div>
              }
            >
              <input type="hidden" name="operation" value="save" />
              <input type="hidden" name="revision" value={data.request?.revision || ''} />
              <input type="hidden" name="description" value={data.request?.description || ''} />
              <div className="flex flex-col gap-5">
                <FormRow columns={2}>
                  <FormField label="活动名称" htmlFor="sign-title">
                    <Input id="sign-title" name="title" defaultValue={data.request?.title} required />
                  </FormField>
                  <FormField label="截止时间" htmlFor="sign-due">
                    <Input id="sign-due" type="datetime-local" name="dueAt" defaultValue={due} required />
                  </FormField>
                </FormRow>
                <FormField label="学校" htmlFor="sign-school" hint={data.request?.publishedAt ? '发布后学校不可更改。' : undefined}>
                  <SimpleSelect
                    id="sign-school"
                    name="schoolId"
                    value={school}
                    onValueChange={setSchool}
                    disabled={!!data.request?.publishedAt}
                    options={data.schools.map((item) => ({ value: item.id, label: item.name }))}
                    required
                  />
                </FormField>
                <FormField label="签署用户组" hint="包括尚未绑定账号的花名册学生。">
                  <div role="group" aria-label="签署用户组" className="grid max-h-64 gap-4 overflow-y-auto py-2 sm:grid-cols-2 lg:grid-cols-3">
                    {data.groups
                      .filter((group) => group.schoolId === school)
                      .map((group) => (
                        <Checkbox
                          key={group.id}
                          name="groupIds"
                          value={group.id}
                          defaultChecked={data.request?.groupIds.includes(group.id)}
                          label={group.name}
                        />
                      ))}
                  </div>
                </FormField>
                <FormField
                  label="教师协作者 UID"
                  htmlFor="sign-collaborators"
                  optional
                  hint="以逗号分隔。协作者只能查看进度、提醒和下载，不能修改文档或代签。"
                >
                  <Input id="sign-collaborators" name="collaboratorUids" defaultValue={data.request?.collaboratorUids.join(', ')} />
                </FormField>
              </div>
            </Panel>
          </form>
        </div>
      )}
      {data.request && (
        <div hidden={tab !== 'document'}>
          <Panel
            title="知情书与签署位置"
            description={data.document?.name}
            actions={
              data.document && (
                <Badge tone={data.document.confirmed && !fieldsDirty ? 'success' : 'warning'}>
                  {data.document.confirmed && !fieldsDirty ? '排版已确认' : '待标定并确认'}
                </Badge>
              )
            }
          >
            <div className="space-y-5">
              {data.canEdit && draft && (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void action('source', new FormData(event.currentTarget));
                  }}
                >
                  <input type="hidden" name="operation" value="source" />
                  <input type="hidden" name="revision" value={data.request.revision} />
                  <FormField label="知情书文件" htmlFor="sign-source" hint="最大 32 MB、50 页。支持 PDF、DOCX；DOCX 转换后请核对排版。">
                    <input
                      ref={sourceFile}
                      id="sign-source"
                      type="file"
                      name="file"
                      accept=".pdf,.docx"
                      required
                      className="sr-only"
                      onChange={(event) => setSourceName(event.target.files?.[0]?.name || '')}
                    />
                    <Toolbar>
                      <Button type="button" variant="secondary" onClick={() => sourceFile.current?.click()}>
                        <Upload />
                        选择文档
                      </Button>
                      <span className="min-w-0 break-all text-sm text-fg-muted">{sourceName || '尚未选择文件'}</span>
                      <Button type="submit" variant="secondary" disabled={busy || !sourceName}>
                        上传并转换文档
                      </Button>
                    </Toolbar>
                  </FormField>
                </form>
              )}
              {data.sourceUrl && (
                <>
                  {data.canEdit && draft && (
                    <div className="space-y-3 border-y border-line-subtle py-4">
                      <Toolbar>
                        <Button variant="secondary" onClick={() => setMarking(!marking)} disabled={!!preview} aria-pressed={marking}>
                          标定位置
                        </Button>
                        <SimpleSelect
                          ariaLabel="标定字段"
                          className="w-40"
                          value={kind}
                          onValueChange={(value) => {
                            if (kinds.includes(value as FieldKind)) setKind(value as FieldKind);
                          }}
                          options={kinds.map((item) => ({ value: item, label: labels[item] }))}
                          disabled={!!preview}
                        />
                        <span className="text-sm text-fg-muted">
                          {marking ? '在文档上拖出矩形，可在多页重复放置。' : '开启标定后，依次放置学号、姓名、时间和签名。'}
                        </span>
                      </Toolbar>
                      <div className="flex flex-wrap gap-2">
                        {fields.map((field, index) => (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            key={index}
                            onClick={() => setFields(fields.filter((_, i) => i !== index))}
                            aria-label={`删除第 ${field.page} 页${labels[field.kind]}位置`}
                          >
                            第 {field.page} 页 · {labels[field.kind]}
                            <X />
                          </Button>
                        ))}
                      </div>
                      <Toolbar>
                        <Button
                          variant="secondary"
                          disabled={busy || kinds.some((item) => !fields.some((field) => field.kind === item))}
                          onClick={() => void showPreview()}
                        >
                          查看填入示例后的 PDF
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy || kinds.some((item) => !fields.some((field) => field.kind === item))}
                          onClick={() => void action('fields', { fields })}
                        >
                          确认排版并保存位置
                        </Button>
                      </Toolbar>
                    </div>
                  )}
                  {preview && (
                    <Button variant="secondary" onClick={() => setPreview('')}>
                      返回原文标定
                    </Button>
                  )}
                  <SigningPdfViewer
                    url={preview || data.sourceUrl}
                    fields={preview ? [] : fields}
                    onMark={
                      data.canEdit && draft && marking && !preview
                        ? (field) => {
                            if (fields.length >= 32) setError('最多标定 32 个位置');
                            else setFields([...fields, field]);
                          }
                        : undefined
                    }
                    kind={kind}
                  />
                </>
              )}
              {data.canEdit && (
                <Toolbar>
                  {draft ? (
                    <Button variant="primary" disabled={busy || !data.document?.confirmed || fieldsDirty} onClick={() => void action('publish')}>
                      发布签署
                    </Button>
                  ) : (
                    <>
                      {data.request.status === 'published' && (
                        <Button variant="secondary" disabled={busy} onClick={() => void action('close')}>
                          关闭签署
                        </Button>
                      )}
                      {data.request.status === 'closed' && (
                        <Button variant="secondary" disabled={busy} onClick={() => void action('open')}>
                          重新开放
                        </Button>
                      )}
                      <Button variant="secondary" disabled={busy} onClick={() => void action('copy')}>
                        复制为新活动
                      </Button>
                    </>
                  )}
                </Toolbar>
              )}
            </div>
          </Panel>
        </div>
      )}
      {data.request && tab === 'progress' && (
        <div className="space-y-5">
          <section aria-label="签署统计">
            <Panel>
              <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
                <Stat label="应签人数" value={summary.total} unit="人" hint="当前用户组的完整名单" />
                <Stat label="已签署" value={summary.signed} unit="人" hint="已成功归档，含可重签学生" />
                <Stat label="未签署" value={summary.unsigned} unit="人" hint="包含尚未完成归档的学生" />
                <Stat label="其中未绑定账号" value={summary.unboundUnsigned} unit="人" hint="未签署学生中尚未绑定的部分" />
              </div>
            </Panel>
          </section>
          {data.signUrl && (
            <Panel title="学生签署链接">
              <FormField label="将此链接发给学生" htmlFor="sign-link" hint="未登录或尚未绑定的学生会先完成引导，再自动返回签署。">
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="sign-link"
                    readOnly
                    value={new URL(data.signUrl, window.location.origin).href}
                    onFocus={(event) => event.target.select()}
                    className="min-w-0 flex-1"
                  />
                  <Button asChild variant="secondary">
                    <a href={data.signUrl}>
                      <ExternalLink />
                      打开签署页面
                    </a>
                  </Button>
                </div>
              </FormField>
            </Panel>
          )}
          <Panel title="签署名单" description="统计按完整应签名单计算，不随筛选变化；已离组的签署保留在全量下载中。" flush>
            <div className="space-y-4 border-b border-line-subtle p-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <FormField label="搜索学生" htmlFor="signing-student-search">
                  <SearchInput
                    id="signing-student-search"
                    placeholder="姓名或学号"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </FormField>
                <FormField label="用户组" htmlFor="signing-group-filter">
                  <SimpleSelect
                    id="signing-group-filter"
                    value={groupFilter}
                    onValueChange={setGroupFilter}
                    options={[{ value: 'all', label: '全部用户组' }, ...signingGroups.map((group) => ({ value: group.id, label: group.name }))]}
                  />
                </FormField>
                <FormField label="签署状态" htmlFor="signing-status-filter">
                  <SimpleSelect
                    id="signing-status-filter"
                    value={statusFilter}
                    onValueChange={(value) => setStatusFilter(value as SigningStatusFilter)}
                    options={[
                      { value: 'all', label: '全部签署状态' },
                      { value: 'signed', label: '已签署' },
                      { value: 'unsigned', label: '未签署' },
                      { value: 'pending', label: '待完成归档' },
                      { value: 'resign', label: '允许重签' },
                    ]}
                  />
                </FormField>
                <FormField label="账号绑定" htmlFor="signing-binding-filter">
                  <SimpleSelect
                    id="signing-binding-filter"
                    value={bindingFilter}
                    onValueChange={(value) => setBindingFilter(value as SigningBindingFilter)}
                    options={[
                      { value: 'all', label: '全部绑定状态' },
                      { value: 'bound', label: '已绑定账号' },
                      { value: 'unbound', label: '未绑定账号' },
                    ]}
                  />
                </FormField>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <p role="status" className="text-sm text-fg-muted">
                  显示 {filteredRows.length} / {summary.total} 人
                </p>
                {hasFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearch('');
                      setStatusFilter('all');
                      setBindingFilter('all');
                      setGroupFilter('all');
                    }}
                  >
                    清除筛选
                  </Button>
                )}
              </div>
              <Toolbar>
                <Button variant="secondary" disabled={busy || !filteredRows.length} onClick={() => void pack(false, true)}>
                  <FileDown />
                  下载筛选结果 ZIP
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => void pack(false)}>
                  下载全部当前签署 ZIP
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => void pack(true)}>
                  下载全部历史版本 ZIP
                </Button>
                {['published', 'closed'].includes(data.request.status) && (
                  <Button variant="secondary" disabled={busy} onClick={() => void action('nudge')}>
                    <Bell />
                    提醒全部待签或重签学生
                  </Button>
                )}
              </Toolbar>
              <p className="text-xs text-fg-subtle">筛选结果包含当前显示名单及这些学生的最新签署 PDF；未签署的学生只导出名单。</p>
            </div>
            <DataTable
              rows={filteredRows}
              rowKey={(row) => row.studentRecordId}
              mobile="stack"
              empty={
                <EmptyState
                  title={hasFilters ? '没有符合筛选条件的学生' : '当前用户组暂无应签学生'}
                  description={hasFilters ? '请调整条件或清除筛选。' : '请检查活动选择的用户组。'}
                />
              }
              columns={[
                {
                  key: 'student',
                  header: '学生',
                  stackRole: 'title',
                  cell: (row) => (
                    <div>
                      <span>{row.realName}</span>
                      <span className="ml-2 font-mono text-xs text-fg-subtle">{row.studentId}</span>
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: '状态',
                  stackRole: 'meta',
                  cell: (row) => (
                    <Badge tone={row.status === 'signed' ? 'success' : row.status === 'unbound' ? 'warning' : 'neutral'}>
                      {row.status === 'signed'
                        ? row.resignAllowed
                          ? '已签署（可重签）'
                          : '已签署'
                        : row.status === 'pending'
                          ? '待完成归档'
                          : row.status === 'unbound'
                            ? '未绑定账号'
                            : '未签署'}
                    </Badge>
                  ),
                },
                {
                  key: 'binding',
                  header: '账号绑定',
                  cell: (row) => <span className="text-sm text-fg-muted">{row.uid === null ? '未绑定账号' : '已绑定账号'}</span>,
                },
                { key: 'time', header: '签署时间', cell: (row) => <DateTime value={row.signedAt} mode="datetime" /> },
                {
                  key: 'actions',
                  header: '操作',
                  cell: (row) => (
                    <TableActions>
                      {row.currentFileId && <TableAction href={`${data.fileBaseUrl}${row.currentFileId}`}>下载 PDF</TableAction>}
                      {data.canEdit && (row.currentFileId || row.status === 'pending') && (
                        <TableAction
                          disabled={busy}
                          onClick={() => {
                            void confirmDialog(`允许 ${row.realName} 重新签署？旧版本会保留。`, {
                              title: '允许重新签署',
                              confirmLabel: '允许重签',
                            }).then((confirmed) => {
                              if (confirmed) void action('reopen', { studentRecordId: row.studentRecordId });
                            });
                          }}
                        >
                          允许重签
                        </TableAction>
                      )}
                    </TableActions>
                  ),
                },
              ]}
            />
          </Panel>
        </div>
      )}
    </ModuleWorkspace>
  );
}
