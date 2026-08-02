import { IconChevronRight } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

export interface Crumb {
  label: string;
  /** Omit on the last crumb — it renders as the current page, not a link. */
  href?: string;
}

/**
 * Page header in the app shell: an optional breadcrumb trail
 * above a tight `leading-none` title, a muted metadata line under it, and the
 * action cluster on the right.
 */
export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
}: {
  title: string;
  description?: string;
  breadcrumb?: Crumb[];
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-2">
            <ol className="flex flex-wrap items-center gap-1.5">
              {breadcrumb.map((crumb, i) => {
                const isLast = i === breadcrumb.length - 1;
                return (
                  <li key={`${crumb.label}-${i}`} className="flex items-center gap-1.5">
                    {i > 0 && <IconChevronRight aria-hidden className="size-3 text-muted-foreground" />}
                    {crumb.href && !isLast ? (
                      <Link
                        to={crumb.href}
                        className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span
                        aria-current={isLast ? "page" : undefined}
                        className={isLast ? "text-xs font-medium text-foreground" : "text-xs text-muted-foreground"}
                      >
                        {crumb.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
        <h1 className="text-2xl font-semibold leading-none tracking-tight">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {/* Wrap so wide action clusters (e.g. two Segmented toggles) don't overflow on mobile. */}
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
