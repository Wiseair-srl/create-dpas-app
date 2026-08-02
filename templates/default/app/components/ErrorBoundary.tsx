import { AlertTriangle, Home, RotateCw, SearchX } from "lucide-react";
import { Link, isRouteErrorResponse, useLocation, useRouteError } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Tone = "error" | "notFound";

interface ErrorStateProps {
  tone: Tone;
  title: string;
  detail: string;
  /** Dev-only stack/extra context, rendered in a collapsible block. */
  stack?: string;
  className?: string;
}

function ErrorState({ tone, title, detail, stack, className }: ErrorStateProps) {
  const Icon = tone === "notFound" ? SearchX : AlertTriangle;

  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <div
        className={cn(
          "grid size-12 place-items-center rounded-full",
          tone === "notFound" ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive",
        )}
      >
        <Icon className="size-6" />
      </div>

      <h1 className="mt-4 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1.5 max-w-md text-balance text-sm text-muted-foreground">{detail}</p>

      {stack && (
        <details className="group mt-5 w-full max-w-md text-left">
          <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show error details</span>
            <span className="hidden group-open:inline">Hide error details</span>
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-md border bg-muted/50 p-3 text-[11px] leading-relaxed text-muted-foreground">
            {stack}
          </pre>
        </details>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {tone === "error" && (
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RotateCw className="size-4" />
            Reload page
          </Button>
        )}
        <Button asChild>
          <Link to="/cashflow">
            <Home className="size-4" />
            Back to dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}

function describeRouteError(error: unknown): Omit<ErrorStateProps, "className"> {
  // Errors thrown by loaders/actions as a Response (e.g. a 404 or 500 status).
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      return {
        tone: "notFound",
        title: "Page not found",
        detail:
          typeof error.data === "string" && error.data
            ? error.data
            : "This page doesn’t exist or may have moved.",
      };
    }
    return {
      tone: "error",
      title: `${error.status} ${error.statusText}`.trim(),
      detail:
        typeof error.data === "string" && error.data
          ? error.data
          : "The server returned an unexpected response.",
    };
  }

  // Plain JS exceptions thrown while rendering a route (the common case).
  if (error instanceof Error) {
    return {
      tone: "error",
      title: "Something went wrong",
      detail: error.message || "An unexpected error interrupted this page.",
      stack: import.meta.env.DEV ? (error.stack ?? error.message) : undefined,
    };
  }

  return {
    tone: "error",
    title: "Something went wrong",
    detail: "An unexpected error interrupted this page.",
  };
}

/**
 * In-shell boundary: rendered inside the AppLayout content area, so the header and
 * sidebar stay put and the user can navigate away. Use as `errorElement` on page routes.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  return <ErrorState {...describeRouteError(error)} className="mx-auto max-w-lg py-16" />;
}

/**
 * Full-screen boundary: for failures in the shell itself (layout, header, auth) where
 * there is no chrome left to preserve. Mirrors the centered SignIn layout.
 */
export function RootErrorBoundary() {
  const error = useRouteError();
  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 p-6">
      <ErrorState {...describeRouteError(error)} className="max-w-lg" />
    </div>
  );
}

/** Friendly 404 for unmatched routes, rendered inside the app shell. */
export function NotFound() {
  const { pathname } = useLocation();
  return (
    <ErrorState
      tone="notFound"
      title="Page not found"
      detail={`No page matches ${pathname}.`}
      className="mx-auto max-w-lg py-16"
    />
  );
}
