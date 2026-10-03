/**
 * 荣誉照片墙（PLAN 2026-07-02 §7）——按年展示天梯赛团队获奖和
 * ICPC/CCPC 队伍获奖的照片与成绩。带 PERM_RANKBOARD_IMPORT 的用户
 * （教师/管理员）可直接在卡片上传照片：先传 Hydro /file 拿 URL，
 * 再 POST operation=addImage 挂到该卡片的代表奖项上。
 */
import { useState } from 'react';
import { AlertCircle, ArrowLeft, Award as AwardIcon, Camera, CircleCheck, ImageOff, LoaderCircle, Trophy, Users, ZoomIn } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { uploadUserFile } from '@/lib/upload';
import { formatGalleryTeamRank, type GalleryTeamRankStatus } from './gallery-team-rank';

interface GalleryMember {
  personId: string;
  realName: string;
  studentId: string;
  awardIndex: number;
  score?: number;
}

interface GalleryCardBase {
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

type GalleryCard =
  | (GalleryCardBase & { kind: 'ladder' })
  | (GalleryCardBase & { kind: 'icpc'; teamRank: number | null; teamRankStatus: GalleryTeamRankStatus });

interface YearBucket {
  year: number | null;
  ladder: GalleryCard[];
  icpc: GalleryCard[];
}

function TeamCard({ card, canUpload, uid, onLightbox }: { card: GalleryCard; canUpload: boolean; uid: number; onLightbox: (url: string) => void }) {
  const [imageUrls, setImageUrls] = useState<string[]>(card.imageUrls);
  const [uploading, setUploading] = useState(false);
  const [uploadSucceeded, setUploadSucceeded] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const cover = imageUrls[card.coverIndex] || imageUrls[0] || null;
  const teamRankStatus = card.kind === 'icpc' ? card.teamRankStatus : null;
  const teamRankLabel = card.kind === 'icpc' ? formatGalleryTeamRank(card.teamRankStatus, card.teamRank) : null;

  const upload = async (file: File) => {
    setUploading(true);
    setUploadSucceeded(false);
    setErrorMessage('');
    try {
      const url = await uploadUserFile(file, uid);
      const attach = await fetchHydroResponse('/rankboard/gallery', {
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
          await readHydroResponseError(attach, attach.status === 409 ? '页面数据已过期（奖项列表已被他人修改），请刷新后重试' : '照片关联失败'),
        );
      }
      const data = (await attach.json().catch(() => null)) as { imageUrls?: unknown } | null;
      if (!data || !Array.isArray(data.imageUrls) || !data.imageUrls.every((item) => typeof item === 'string') || !data.imageUrls.includes(url)) {
        throw new Error('服务器没有确认照片已保存，请重试');
      }
      setImageUrls(data.imageUrls);
      setUploadSucceeded(true);
    } catch (error) {
      setUploadSucceeded(false);
      const message = (error as { message?: unknown } | null)?.message;
      setErrorMessage(typeof message === 'string' && message ? message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Panel flush className="h-full">
      <div className="relative aspect-video w-full overflow-hidden bg-surface-sunken">
        {cover ? (
          <Button type="button" variant="ghost" onClick={() => onLightbox(cover)} className="block h-auto! w-full rounded-none p-0">
            <img src={cover} alt={card.title} className="size-full object-cover" />
          </Button>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 text-fg-subtle">
            <ImageOff className="size-6" />
            <span className="text-xs">暂无照片</span>
          </div>
        )}
        {cover || canUpload ? (
          <div className="absolute top-2 right-2 flex items-center gap-1">
            {cover ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconOnly
                title="查看大图"
                onClick={() => onLightbox(cover)}
                className="rounded-full bg-scrim text-bg hover:bg-scrim hover:text-bg"
              >
                <ZoomIn />
              </Button>
            ) : null}
            {canUpload ? (
              <label
                title={imageUrls.length ? '替换照片' : '上传照片'}
                className={cn(
                  'flex size-8 cursor-pointer items-center justify-center rounded-full bg-scrim text-bg',
                  uploading && 'pointer-events-none opacity-45',
                )}
              >
                <Camera className="size-3.5" />
                <input
                  type="file"
                  accept="image/*"
                  aria-label={imageUrls.length ? '替换照片' : '上传照片'}
                  className="hidden"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) upload(file);
                    event.target.value = '';
                  }}
                />
              </label>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="space-y-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" title={card.title}>
              {card.title}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone="neutral" size="sm">{card.typeName}</Badge>
              {card.team ? (
                <Badge variant="outline" tone="neutral" size="sm">
                  <Users className="size-3" />
                  {card.team}
                </Badge>
              ) : null}
            </div>
            {teamRankLabel ? (
              <p
                className={cn(
                  'mt-1.5 text-xs font-semibold tabular',
                  teamRankStatus === 'confirmed'
                    ? 'text-fg'
                    : teamRankStatus === 'conflict'
                      ? 'text-danger-fg'
                      : 'text-warning-fg',
                )}
              >
                {teamRankLabel}
              </p>
            ) : null}
          </div>
          {card.kind === 'ladder' ? <Trophy className="size-4 shrink-0 text-fg-subtle" /> : <AwardIcon className="size-4 shrink-0 text-fg-subtle" />}
        </div>

        <div className="flex flex-wrap gap-1">
          {card.members.map((member) => (
            <span
              key={`${member.personId}-${member.awardIndex}`}
              className="inline-flex items-center gap-1 rounded-sm bg-surface-active px-1.5 py-0.5 text-2xs"
              title={member.studentId}
            >
              {member.realName}
              {member.score != null ? <span className="tabular text-fg-muted">{member.score}</span> : null}
            </span>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          {imageUrls
            .filter((url) => url !== cover)
            .slice(0, 4)
            .map((url) => (
              <Button
                key={url}
                type="button"
                variant="ghost"
                onClick={() => onLightbox(url)}
                className="size-10 h-10! w-10! overflow-hidden rounded-md p-0"
              >
                <img src={url} alt="" className="size-full object-cover" />
              </Button>
            ))}
          {canUpload ? (
            <label
              title={imageUrls.length ? '替换照片' : '上传照片'}
              className={cn(
                'flex size-10 cursor-pointer items-center justify-center rounded-md border border-dashed border-line text-fg-muted hover:border-brand hover:text-brand-fg',
                uploading && 'pointer-events-none opacity-45',
              )}
            >
              <Camera className="size-4" />
              <input
                type="file"
                accept="image/*"
                aria-label={imageUrls.length ? '替换照片' : '上传照片'}
                className="hidden"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) upload(file);
                  event.target.value = '';
                }}
              />
            </label>
          ) : null}
          {uploading ? (
            <span role="status" aria-live="polite" className="inline-flex items-center gap-1 text-xs text-fg-muted">
              <LoaderCircle className="size-3.5 animate-spin" />
              上传中…
            </span>
          ) : uploadSucceeded ? (
            <span role="status" aria-live="polite" className="inline-flex items-center gap-1 text-xs text-success-fg">
              <CircleCheck className="size-3.5" />
              照片已保存
            </span>
          ) : null}
        </div>
      </div>
      <Dialog open={!!errorMessage} onOpenChange={(open) => !open && setErrorMessage('')}>
        <DialogContent onClose={() => setErrorMessage('')}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="size-4 text-danger-fg" />
              照片上传失败
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-fg-muted">{errorMessage}</p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="primary" onClick={() => setErrorMessage('')}>
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function GalleryGrid({ cards, canUpload, uid, onLightbox }: { cards: GalleryCard[]; canUpload: boolean; uid: number; onLightbox: (url: string) => void }) {
  return (
    <div className="grid w-full min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card, index) => (
        <TeamCard
          key={`${card.contest || ''}-${card.typeKey}-${card.team || index}`}
          card={card}
          canUpload={canUpload}
          uid={uid}
          onLightbox={onLightbox}
        />
      ))}
    </div>
  );
}

export function RankBoardGalleryPage() {
  const bs = useBootstrap();
  const data = bs.page.data as { years: YearBucket[]; canUpload: boolean };
  const years: YearBucket[] = data.years || [];
  const [lightbox, setLightbox] = useState<string | null>(null);
  const description = `按年展示天梯赛团队与 ICPC / CCPC 队伍的获奖照片和成绩${data.canUpload ? '。点卡片上的相机图标可直接上传照片。' : ''}`;

  return (
    <Page width="full">
      <PageHeader
        title="荣誉照片墙"
        description={description}
        actions={(
          <Button asChild variant="ghost" size="sm" iconOnly>
            <a href="/rankboard" aria-label="返回荣誉榜" title="返回荣誉榜">
              <ArrowLeft className="size-4" />
            </a>
          </Button>
        )}
      />

      {years.length === 0 ? (
        <EmptyState compact title="还没有可展示的获奖记录。" />
      ) : (
        years.map((bucket) => (
          <section key={bucket.year ?? 'unknown'} className="space-y-4">
            <h2 className="flex items-center gap-2 border-b border-line pb-2 text-lg font-semibold">
              {bucket.year ?? '年份未知'}
              <span className="text-xs font-normal text-fg-subtle">{bucket.ladder.length + bucket.icpc.length} 项</span>
            </h2>
            {bucket.ladder.length > 0 ? (
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-fg-subtle">
                  <Trophy className="size-3.5" />
                  天梯赛（团队）
                </h3>
                <GalleryGrid cards={bucket.ladder} canUpload={data.canUpload} uid={bs.user.id} onLightbox={setLightbox} />
              </div>
            ) : null}
            {bucket.icpc.length > 0 ? (
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-fg-subtle">
                  <AwardIcon className="size-3.5" />
                  ICPC / CCPC（队伍）
                </h3>
                <GalleryGrid cards={bucket.icpc} canUpload={data.canUpload} uid={bs.user.id} onLightbox={setLightbox} />
              </div>
            ) : null}
          </section>
        ))
      )}

      <Dialog open={lightbox !== null} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent size="xl" onClose={() => setLightbox(null)}>
          <DialogHeader>
            <DialogTitle className="sr-only">照片</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {lightbox ? <img src={lightbox} alt="" className="w-full object-contain" /> : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
