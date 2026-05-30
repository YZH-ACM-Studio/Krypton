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
    <footer className="mt-12 border-t bg-muted/20 text-muted-foreground">
      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 text-xs sm:grid-cols-3 sm:px-6 lg:px-8">
        {/* Left: copyright + site */}
        <div className="space-y-1">
          <p className="font-medium text-foreground">{bs.siteName || bs.appName || 'Krypton'}</p>
          <p>© {year} · 由 <span className="text-foreground">{bs.appName || 'Krypton'}</span> 提供</p>
          <p className="flex items-center gap-1">
            <Heart className="size-3" />
            Powered by Hydro + Krypton
          </p>
        </div>

        {/* Middle: links */}
        <nav className="flex flex-wrap items-start gap-3">
          <a href="/wiki/about" className="hover:text-foreground">关于</a>
          <a href="/wiki/help" className="hover:text-foreground">帮助</a>
          <a href="/wiki/tos" className="hover:text-foreground">服务条款</a>
          <a href="/wiki/privacy" className="hover:text-foreground">隐私</a>
          <a
            href="https://github.com/hydro-dev/Hydro"
            className="flex items-center gap-1 hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            <Github className="size-3" />
            GitHub
          </a>
        </nav>

        {/* Right: ICP / domain / system extras */}
        <div className="space-y-1 sm:text-right">
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
  return html.split('\n').map((s) => s.trim()).filter(Boolean);
}
