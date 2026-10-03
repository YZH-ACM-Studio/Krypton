/**
 * Page footer rendered below the main outlet. Three columns:
 *   - left: copyright + site name
 *   - middle: doc/help/about links
 *   - right: ICP / police record / extras injected from system & domain
 *
 * The HTML in `bootstrap.footer.systemHtml` / `domainHtml` comes from
 * trusted admins via the system settings UI; we render it with
 * `dangerouslySetInnerHTML` (one block per non-empty newline-separated line)
 * so existing CN compliance markup (beian / 公网安备) keeps working without
 * config changes.
 */
import { Github, Heart } from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';

export function KryptonFooter() {
  const bs = useBootstrap();
  const year = new Date().getFullYear();
  const sysLines = splitLines(bs.footer?.systemHtml);
  const domLines = splitLines(bs.footer?.domainHtml);

  return (
    <footer className="border-t border-line-subtle px-4 py-6 text-xs text-fg-subtle">
      <div className="mx-auto grid max-w-7xl gap-4 sm:grid-cols-3">
        {/* Left: copyright + site */}
        <div className="space-y-1">
          <p className="font-medium text-fg">{bs.siteName || bs.appName || 'Krypton'}</p>
          <p>
            © {year} · 由 <span className="text-fg">{bs.appName || 'Krypton'}</span> 提供
          </p>
          <p className="flex items-center gap-1">
            <Heart className="size-3" />
            Powered by Hydro + Krypton
          </p>
        </div>

        {/* Middle: links */}
        <nav className="flex flex-wrap items-start gap-3">
          <a href="/wiki/about" className="inline-flex min-h-11 items-center hover:text-fg sm:min-h-0">
            关于
          </a>
          <a href="/wiki/help" className="inline-flex min-h-11 items-center hover:text-fg sm:min-h-0">
            帮助
          </a>
          <a href="/wiki/tos" className="inline-flex min-h-11 items-center hover:text-fg sm:min-h-0">
            服务条款
          </a>
          <a href="/wiki/privacy" className="inline-flex min-h-11 items-center hover:text-fg sm:min-h-0">
            隐私
          </a>
          <a href="https://github.com/hydro-dev/Hydro" className="inline-flex min-h-11 items-center gap-1 hover:text-fg sm:min-h-0" target="_blank" rel="noreferrer">
            <Github className="size-3" />
            GitHub
          </a>
        </nav>

        {/* Right: ICP / domain / system extras */}
        <div className="min-w-0 space-y-1 break-words sm:text-right">
          {domLines.map((html, i) => (
            <p key={`d${i}`} dangerouslySetInnerHTML={{ __html: html }} />
          ))}
          {sysLines.map((html, i) => (
            <p key={`s${i}`} dangerouslySetInnerHTML={{ __html: html }} />
          ))}
        </div>
      </div>
    </footer>
  );
}

function splitLines(html?: string): string[] {
  if (!html) return [];
  return html
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}
