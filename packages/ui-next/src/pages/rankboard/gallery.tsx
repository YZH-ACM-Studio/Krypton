/**
 * 荣誉照片墙（PLAN 2026-07-02 §7）——按年展示天梯赛团队获奖和
 * ICPC/CCPC 队伍获奖的照片与成绩。带 PERM_RANKBOARD_IMPORT 的用户
 * （教师/管理员）可直接在卡片上传照片：先传 Hydro /file 拿 URL，
 * 再 POST operation=addImage 挂到该卡片的代表奖项上。
 */
import { useState } from 'react';
import { AlertCircle, ArrowLeft, Award as AwardIcon, Camera, ImageOff, Trophy, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { uploadUserFile } from '@/lib/upload';

interface GalleryMember {
  personId: string;
  realName: string;
  studentId: string;
  awardIndex: number;
  score?: number;
}

interface GalleryCard {
  kind: 'ladder' | 'icpc';
  year: number | null;
  title: string;
  typeKey: string;
  typeName: string;
  team: string | null;
  contest: string | null;
  members: GalleryMember[];
  imageUrls: string[];
  coverIndex: number;
  uploadTarget: { personId: string; awardIndex: number };
}

interface YearBucket {
  year: number | null;
  ladder: GalleryCard[];
  icpc: GalleryCard[];
}

async function responseErrorMessage(response: Response, fallback: string) {
  const raw = await response.text().catch(() => '');
  if (raw) {
    try {
      const body = JSON.parse(raw);
      const message = body?.error?.message || body?.message || body?.error;
      if (typeof message === 'string' && message.trim()) return message;
    } catch {
      const text = raw.trim();
      if (text && !text.startsWith('<!DOCTYPE') && !text.startsWith('<html')) return text.slice(0, 180);
    }
  }
  return `${fallback}（HTTP ${response.status}）`;
}

function TeamCard({ card, canUpload, uid, onLightbox }: { card: GalleryCard; canUpload: boolean; uid: number; onLightbox: (url: string) => void }) {
  const [imageUrls, setImageUrls] = useState<string[]>(card.imageUrls);
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const cover = imageUrls[card.coverIndex] || imageUrls[0] || null;

  const upload = async (file: File) => {
    setUploading(true);
    setErrorMessage('');
    try {
      const url = await uploadUserFile(file, uid);
      const attach = await fetch('/rankboard/gallery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          operation: 'addImage',
          personId: card.uploadTarget.personId,
          awardIndex: card.uploadTarget.awardIndex,
          // 目标奖项的身份校验：页面快照过期（别人回滚/编辑导致数组重排）
          // 时服务端拒绝，防止照片挂错奖项。
          expectType: card.typeKey,
          url,
          setCover: imageUrls.length === 0,
          replace: imageUrls.length > 0,
        }),
      });
      if (!attach.ok) {
        throw new Error(
          await responseErrorMessage(attach, attach.status === 409 ? '页面数据已过期（奖项列表已被他人修改），请刷新后重试' : '照片关联失败'),
        );
      }
      const data = await attach.json().catch(() => ({}));
      setImageUrls(data.imageUrls || [...imageUrls, url]);
    } catch (e: any) {
      setErrorMessage(e?.message || '图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      {/* 封面区 */}
      {cover ? (
        <button type="button" onClick={() => onLightbox(cover)} className="block h-44 w-full overflow-hidden bg-muted">
          <img src={cover} alt={card.title} className="size-full object-cover transition-transform hover:scale-105" />
        </button>
      ) : (
        <div className="flex h-44 w-full flex-col items-center justify-center gap-1.5 bg-muted/40 text-muted-foreground">
          <ImageOff className="size-6" />
          <span className="text-xs">暂无照片</span>
        </div>
      )}
      <CardContent className="space-y-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" title={card.title}>
              {card.title}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="text-[10px]">
                {card.typeName}
              </Badge>
              {card.team ? (
                <Badge variant="outline" className="text-[10px]">
                  <Users className="mr-0.5 size-2.5" />
                  {card.team}
                </Badge>
              ) : null}
            </div>
          </div>
          {card.kind === 'ladder' ? <Trophy className="size-4 shrink-0 text-amber-500" /> : <AwardIcon className="size-4 shrink-0 text-primary" />}
        </div>

        {/* 成员与成绩 */}
        <div className="flex flex-wrap gap-1">
          {card.members.map((m) => (
            <span
              key={`${m.personId}-${m.awardIndex}`}
              className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-[11px]"
              title={m.studentId}
            >
              {m.realName}
              {m.score != null ? <span className="font-mono text-muted-foreground">{m.score}</span> : null}
            </span>
          ))}
        </div>

        {/* 更多照片 + 上传 */}
        <div className="flex items-center gap-1.5">
          {imageUrls
            .filter((u) => u !== cover)
            .slice(0, 4)
            .map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => onLightbox(u)}
                className="size-10 overflow-hidden rounded border bg-muted hover:opacity-80"
              >
                <img src={u} alt="" className="size-full object-cover" />
              </button>
            ))}
          {canUpload ? (
            <label
              title={imageUrls.length ? '替换照片' : '上传照片'}
              className={cn(
                'flex size-10 cursor-pointer items-center justify-center rounded border border-dashed text-muted-foreground transition-colors hover:border-primary hover:text-primary',
                uploading && 'pointer-events-none opacity-50',
              )}
            >
              <Camera className="size-4" />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                  e.target.value = '';
                }}
              />
            </label>
          ) : null}
        </div>
      </CardContent>
      <Dialog open={!!errorMessage} onOpenChange={(open) => !open && setErrorMessage('')}>
        <DialogContent className="w-full sm:w-[440px]" onClose={() => setErrorMessage('')}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="size-4 text-destructive" />
              照片上传失败
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <p className="text-sm leading-6 text-muted-foreground">{errorMessage}</p>
            <div className="flex justify-end">
              <Button type="button" onClick={() => setErrorMessage('')}>
                知道了
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function RankBoardGalleryPage() {
  const bs = useBootstrap();
  const data = bs.page.data as { years: YearBucket[]; canUpload: boolean };
  const years: YearBucket[] = data.years || [];
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href="/rankboard">
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <div>
          <h1 className="text-xl font-semibold">荣誉照片墙</h1>
          <p className="text-sm text-muted-foreground">
            按年展示天梯赛团队与 ICPC / CCPC 队伍的获奖照片和成绩
            {data.canUpload ? '。点卡片上的相机图标可直接上传照片。' : ''}
          </p>
        </div>
      </div>

      {years.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">还没有可展示的获奖记录。</CardContent>
        </Card>
      ) : (
        years.map((bucket) => (
          <section key={bucket.year ?? 'unknown'} className="space-y-4">
            <h2 className="flex items-center gap-2 border-b pb-2 text-lg font-semibold">
              {bucket.year ?? '年份未知'}
              <span className="text-xs font-normal text-muted-foreground">{bucket.ladder.length + bucket.icpc.length} 项</span>
            </h2>
            {bucket.ladder.length > 0 ? (
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <Trophy className="size-3.5 text-amber-500" />
                  天梯赛（团队）
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {bucket.ladder.map((card, i) => (
                    <TeamCard
                      key={`${card.typeKey}-${card.team || i}`}
                      card={card}
                      canUpload={data.canUpload}
                      uid={bs.user.id}
                      onLightbox={setLightbox}
                    />
                  ))}
                </div>
              </div>
            ) : null}
            {bucket.icpc.length > 0 ? (
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <AwardIcon className="size-3.5 text-primary" />
                  ICPC / CCPC（队伍）
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {bucket.icpc.map((card, i) => (
                    <TeamCard
                      key={`${card.contest || ''}-${card.typeKey}-${card.team || i}`}
                      card={card}
                      canUpload={data.canUpload}
                      uid={bs.user.id}
                      onLightbox={setLightbox}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ))
      )}

      {lightbox && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="max-h-[90vh] max-w-[90vw] object-contain" />
        </div>
      )}
    </div>
  );
}
