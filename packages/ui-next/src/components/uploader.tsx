/**
 * KryptonUploader — wrappers around Uppy that match the rest of the
 * Krypton UI instead of using Uppy's stock Dashboard widget.
 *
 * Two modes:
 *   - `AvatarUpload`: pick a single image, square-crop in a canvas with
 *     drag/zoom, upload via XHR with field name `file`. Used by the
 *     settings page to set the user's avatar.
 *   - `FileUploader`: drag-drop pool for multiple files (testdata,
 *     attachments). Renders our own progress bars.
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import Uppy from '@uppy/core';
import XHRUpload from '@uppy/xhr-upload';
import { Crop, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { makeInitials } from '@/lib/format';

/* ────────────────────────────────────────────────────────────────── */
/*  AvatarUpload — pick → square-crop → upload                        */
/* ────────────────────────────────────────────────────────────────── */

export interface AvatarUploadProps {
  /** Current uname for initials fallback */
  uname: string;
  /** Current avatar URL */
  currentUrl?: string | null;
  /** Endpoint: defaults to /home/avatar */
  endpoint?: string;
  /** Field name on the multipart POST */
  fieldName?: string;
  /** Size of the on-screen avatar preview in px */
  size?: number;
  /** Output crop size — image is exported at this square resolution */
  outputSize?: number;
  /** Triggered after upload succeeds */
  onUploaded?: (newUrl: string) => void;
  /** Triggered to allow caller to set non-file avatars (gravatar/qq/url) */
  onSetProvider?: (avatarSpec: string) => void;
  className?: string;
}

export function AvatarUpload({
  uname,
  currentUrl,
  endpoint = '/home/avatar',
  fieldName = 'file',
  size = 96,
  outputSize = 256,
  onUploaded,
  onSetProvider,
  className,
}: AvatarUploadProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [showProviderTab, setShowProviderTab] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const openPicker = () => fileInputRef.current?.click();

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) {
      setErrorMsg('请选择图片文件');
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      setErrorMsg('图片不能超过 8MB');
      return;
    }
    setErrorMsg(null);
    setPickedFile(f);
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
    // Reset the input so picking the same file twice re-fires onChange.
    e.target.value = '';
  };

  // Release object URLs when no longer needed
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const closeCrop = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPickedFile(null);
    setPreviewUrl(null);
    setErrorMsg(null);
  };

  const handleCroppedBlob = async (blob: Blob) => {
    setBusy(true);
    setErrorMsg(null);
    try {
      // Hand off to a one-shot Uppy instance so XHR mechanics (CSRF, retry,
      // progress) are handled the same way as multi-file uploads.
      const uppy = new Uppy({
        autoProceed: true,
        restrictions: { maxFileSize: 8 * 1024 * 1024, maxNumberOfFiles: 1 },
      }).use(XHRUpload, {
        endpoint,
        fieldName,
        formData: true,
        method: 'POST',
        withCredentials: true,
      });
      uppy.addFile({
        name: 'avatar.png',
        type: 'image/png',
        data: blob,
      });
      const result = await uppy.upload();
      if (result?.failed?.length) {
        const f = result.failed[0];
        throw new Error(f.error || '上传失败');
      }
      // Bust the avatar cache so the new image shows immediately
      const bust = `?v=${Date.now()}`;
      onUploaded?.(currentUrl ? currentUrl.split('?')[0] + bust : `/file/0/.avatar.png${bust}`);
      closeCrop();
      // Reload the page so user.avatarUrl re-resolves everywhere
      window.location.reload();
    } catch (e: any) {
      setErrorMsg(e?.message || '上传失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('flex flex-col items-start gap-3', className)}>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={openPicker}
          className="group relative overflow-hidden rounded-full ring-2 ring-transparent transition-all hover:ring-primary"
          style={{ width: size, height: size }}
          title="更换头像"
        >
          <Avatar className="size-full">
            {currentUrl ? <AvatarImage src={currentUrl} alt={uname} /> : null}
            <AvatarFallback className="text-2xl">{makeInitials(uname || '?')}</AvatarFallback>
          </Avatar>
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
            <Upload className="mr-1 size-3.5" />
            更换
          </span>
        </button>
        <div className="space-y-1.5">
          <Button type="button" variant="outline" size="sm" onClick={openPicker}>
            <Upload className="size-3.5 mr-1" />
            上传图片
          </Button>
          <div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowProviderTab(!showProviderTab)}>
              使用第三方头像
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            ≤ 8MB · JPG/PNG/WebP/GIF
          </p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={handleFile}
      />

      {errorMsg ? (
        <p className="text-xs text-destructive">{errorMsg}</p>
      ) : null}

      {/* Third-party providers (gravatar / qq / github / url) */}
      {showProviderTab ? (
        <ProviderPicker
          endpoint={endpoint}
          onClose={() => setShowProviderTab(false)}
          onSubmitted={(spec) => {
            onSetProvider?.(spec);
            window.location.reload();
          }}
        />
      ) : null}

      {/* Crop dialog */}
      {pickedFile && previewUrl ? (
        <Dialog open onOpenChange={(o) => !o && closeCrop()}>
          <DialogContent className="w-full max-w-xl" onClose={closeCrop}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-1.5">
                <Crop className="size-4" />
                裁剪头像
              </DialogTitle>
            </DialogHeader>
            <CropPanel
              srcUrl={previewUrl}
              outputSize={outputSize}
              busy={busy}
              onCancel={closeCrop}
              onConfirm={handleCroppedBlob}
            />
            {errorMsg ? <p className="text-xs text-destructive">{errorMsg}</p> : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/** Crop interface: image + draggable square overlay; export as PNG. */
function CropPanel({ srcUrl, outputSize, busy, onCancel, onConfirm }: {
  srcUrl: string;
  outputSize: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [crop, setCrop] = useState({ x: 0, y: 0, size: 0 });
  const dragRef = useRef<{ mode: 'move' | 'resize' | null; sx: number; sy: number; cx: number; cy: number; cs: number }>({ mode: null, sx: 0, sy: 0, cx: 0, cy: 0, cs: 0 });

  useEffect(() => {
    if (!imgRef.current || !loaded) return;
    const w = imgRef.current.naturalWidth;
    const h = imgRef.current.naturalHeight;
    setImgSize({ w, h });
    const sz = Math.min(w, h);
    setCrop({ x: (w - sz) / 2, y: (h - sz) / 2, size: sz });
  }, [loaded]);

  // The image is shown at a fixed display width; convert between display
  // px and natural px when interacting with the crop box.
  const displayW = Math.min(540, imgSize.w || 540);
  const scale = imgSize.w ? displayW / imgSize.w : 1;
  const displayH = imgSize.h * scale;
  const dCrop = {
    x: crop.x * scale,
    y: crop.y * scale,
    size: crop.size * scale,
  };

  const onPointerDown = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, cx: crop.x, cy: crop.y, cs: crop.size };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d.mode) return;
    const dx = (e.clientX - d.sx) / scale;
    const dy = (e.clientY - d.sy) / scale;
    if (d.mode === 'move') {
      const nx = Math.max(0, Math.min(imgSize.w - crop.size, d.cx + dx));
      const ny = Math.max(0, Math.min(imgSize.h - crop.size, d.cy + dy));
      setCrop({ ...crop, x: nx, y: ny });
    } else {
      // Square resize from top-left corner: keep bottom-right fixed
      const delta = Math.max(dx, dy);
      let ns = Math.max(32, d.cs - delta);
      ns = Math.min(ns, imgSize.w - d.cx, imgSize.h - d.cy);
      const nx = Math.max(0, d.cx + (d.cs - ns));
      const ny = Math.max(0, d.cy + (d.cs - ns));
      setCrop({ x: nx, y: ny, size: ns });
    }
  };
  const onPointerUp = () => { dragRef.current.mode = null; };

  const exportCrop = useCallback(() => {
    if (!imgRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, outputSize, outputSize);
    ctx.drawImage(
      imgRef.current,
      crop.x, crop.y, crop.size, crop.size,
      0, 0, outputSize, outputSize,
    );
    canvas.toBlob((blob) => {
      if (blob) onConfirm(blob);
    }, 'image/png', 0.92);
  }, [crop, outputSize, onConfirm]);

  return (
    <div className="space-y-3">
      <div className="flex justify-center">
        <div
          ref={containerRef}
          className="relative inline-block bg-muted/20 rounded-md overflow-hidden touch-none"
          style={{ width: displayW, height: displayH || 200 }}
        >
          <img
            ref={imgRef}
            src={srcUrl}
            alt="待裁剪"
            className="block select-none pointer-events-none"
            style={{ width: displayW, height: displayH }}
            onLoad={() => setLoaded(true)}
            draggable={false}
          />
          {loaded ? (
            <>
              {/* Dim overlay */}
              <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.45)' }} />
              {/* Crop hole */}
              <div
                className="absolute outline outline-2 outline-white"
                style={{
                  left: dCrop.x,
                  top: dCrop.y,
                  width: dCrop.size,
                  height: dCrop.size,
                  background: 'transparent',
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
                  borderRadius: '50%',
                  cursor: 'move',
                }}
                onPointerDown={(e) => onPointerDown(e, 'move')}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                {/* Resize handle (top-left) */}
                <div
                  className="absolute -left-1.5 -top-1.5 size-3 cursor-nw-resize rounded-sm bg-white shadow"
                  onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, 'resize'); }}
                  onPointerMove={(e) => { e.stopPropagation(); onPointerMove(e); }}
                  onPointerUp={(e) => { e.stopPropagation(); onPointerUp(); }}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>原图 {imgSize.w}×{imgSize.h}</span>
        <span>裁剪 {Math.round(crop.size)}×{Math.round(crop.size)} → {outputSize}×{outputSize}</span>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>取消</Button>
        <Button onClick={exportCrop} disabled={busy || !loaded}>
          {busy ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Upload className="size-3.5 mr-1" />}
          {busy ? '上传中…' : '确认并上传'}
        </Button>
      </div>
    </div>
  );
}

function ProviderPicker({ endpoint, onClose, onSubmitted }: {
  endpoint: string;
  onClose: () => void;
  onSubmitted: (spec: string) => void;
}) {
  const [provider, setProvider] = useState<'gravatar' | 'qq' | 'github' | 'url'>('gravatar');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!value.trim()) { setErr('值不能为空'); return; }
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append('avatar', `${provider}:${value.trim()}`);
      const res = await fetch(endpoint, { method: 'POST', body: form, credentials: 'include' });
      if (res.ok || res.redirected) {
        onSubmitted(`${provider}:${value.trim()}`);
        onClose();
      } else {
        setErr(`保存失败 (${res.status})`);
      }
    } catch (e: any) { setErr(e?.message || '保存失败'); } finally { setBusy(false); }
  };

  return (
    <div className="w-full max-w-md rounded-md border bg-card p-3 space-y-2 text-sm">
      <p className="font-medium">使用第三方头像</p>
      <div className="flex gap-1.5">
        {(['gravatar', 'qq', 'github', 'url'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setProvider(p)}
            className={cn('rounded px-2 py-1 text-xs', provider === p ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent')}
          >
            {p}
          </button>
        ))}
      </div>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={({
          gravatar: '邮箱地址', qq: 'QQ 号', github: 'GitHub 用户名', url: 'https://...',
        } as const)[provider]}
        className="w-full rounded border bg-background px-2 py-1.5 text-sm"
      />
      {err ? <p className="text-xs text-destructive">{err}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
        <Button size="sm" onClick={handleSubmit} disabled={busy}>{busy ? '保存中…' : '保存'}</Button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/*  FileUploader — drop zone for multi-file uploads                    */
/* ────────────────────────────────────────────────────────────────── */

export interface FileUploaderProps {
  /** Endpoint that accepts a multipart POST */
  endpoint: string;
  /** Field name for each file (defaults to `file`) */
  fieldName?: string;
  /** Extra form fields that should accompany the upload */
  meta?: Record<string, string>;
  /** File size cap (default 64MB) */
  maxFileSize?: number;
  /** Maximum number of files in one batch */
  maxFiles?: number;
  /** Allowed mime types (e.g. `['image/*']`) */
  accept?: string[];
  /** Called after each successful upload */
  onUploaded?: (filename: string) => void;
  /** Called after the whole batch is done */
  onBatchComplete?: () => void;
  className?: string;
}

type Pending = {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: 'queued' | 'uploading' | 'done' | 'failed';
  error?: string;
};

export function FileUploader({
  endpoint,
  fieldName = 'file',
  meta,
  maxFileSize = 64 * 1024 * 1024,
  maxFiles = 50,
  accept,
  onUploaded,
  onBatchComplete,
  className,
}: FileUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<Pending[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const uppyRef = useRef<Uppy | null>(null);

  // Lazy-create the Uppy instance once
  if (!uppyRef.current && typeof window !== 'undefined') {
    const uppy = new Uppy({
      autoProceed: true,
      restrictions: {
        maxFileSize,
        maxNumberOfFiles: maxFiles,
        allowedFileTypes: accept,
      },
    }).use(XHRUpload, {
      endpoint,
      fieldName,
      method: 'POST',
      formData: true,
      withCredentials: true,
    });
    uppy.on('file-added', (file) => {
      setItems((prev) => [...prev, {
        id: file.id, name: file.name || 'file', size: file.size || 0, progress: 0, status: 'queued',
      }]);
    });
    uppy.on('upload-progress', (file, progress) => {
      setItems((prev) => prev.map((it) => it.id === file?.id
        ? { ...it, status: 'uploading', progress: Math.round((progress.bytesUploaded / Math.max(1, progress.bytesTotal || 1)) * 100) }
        : it));
    });
    uppy.on('upload-success', (file) => {
      setItems((prev) => prev.map((it) => it.id === file?.id ? { ...it, status: 'done', progress: 100 } : it));
      if (file?.name) onUploaded?.(file.name);
    });
    uppy.on('upload-error', (file, error) => {
      setItems((prev) => prev.map((it) => it.id === file?.id ? { ...it, status: 'failed', error: error?.message } : it));
    });
    uppy.on('complete', () => { onBatchComplete?.(); });
    uppyRef.current = uppy;
  }

  const ingest = useCallback((files: FileList | File[]) => {
    const uppy = uppyRef.current;
    if (!uppy) return;
    Array.from(files).forEach((f) => {
      try {
        uppy.addFile({
          name: f.name, type: f.type, data: f, meta: meta || {},
        });
      } catch { /* ignore (e.g. dup id, type restriction) */ }
    });
  }, [meta]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) ingest(e.dataTransfer.files);
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed bg-muted/10 px-4 py-6 text-xs text-muted-foreground transition-colors cursor-pointer',
          dragOver && 'border-primary bg-primary/5 text-foreground',
        )}
      >
        <Upload className="size-4" />
        <p>拖拽文件到此处，或点击选择</p>
        <p className="text-[10px]">最大 {Math.round(maxFileSize / (1024 * 1024))}MB · 最多 {maxFiles} 个</p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={accept?.join(',')}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) ingest(e.target.files);
          e.target.value = '';
        }}
      />

      {items.length ? (
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 rounded border bg-card px-2 py-1.5 text-xs">
              <span className="truncate flex-1 font-mono">{it.name}</span>
              <Badge variant="outline" className="text-[9px]">{Math.round(it.size / 1024)} KB</Badge>
              {it.status === 'done' ? (
                <Badge variant="default" className="text-[9px]">已上传</Badge>
              ) : it.status === 'failed' ? (
                <Badge variant="destructive" className="text-[9px]" title={it.error}>失败</Badge>
              ) : (
                <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${it.progress}%` }}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  uppyRef.current?.removeFile(it.id);
                  setItems((prev) => prev.filter((x) => x.id !== it.id));
                }}
                className="text-muted-foreground hover:text-destructive"
                title="移除"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
