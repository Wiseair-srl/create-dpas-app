"use client";

import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Assistant answers arrive as markdown — bold device names, inline code for
 * ids, the occasional list. Rendering it as plain text shows the syntax
 * (`**turin-vanchiglia-01**`) instead of the emphasis.
 *
 * react-markdown builds a React tree rather than injecting HTML, so model
 * output can never introduce markup. Raw HTML is not enabled.
 */
const COMPONENTS = {
  p: (props: React.ComponentProps<"p">) => <p className="mb-2 last:mb-0" {...props} />,
  strong: (props: React.ComponentProps<"strong">) => (
    <strong className="font-semibold" {...props} />
  ),
  em: (props: React.ComponentProps<"em">) => <em className="italic" {...props} />,
  ul: (props: React.ComponentProps<"ul">) => (
    <ul className="mb-2 list-disc space-y-0.5 pl-4 last:mb-0" {...props} />
  ),
  ol: (props: React.ComponentProps<"ol">) => (
    <ol className="mb-2 list-decimal space-y-0.5 pl-4 last:mb-0" {...props} />
  ),
  li: (props: React.ComponentProps<"li">) => <li className="leading-6" {...props} />,
  a: (props: React.ComponentProps<"a">) => (
    <a
      className="underline underline-offset-2 hover:text-accent"
      target="_blank"
      rel="noreferrer noopener"
      {...props}
    />
  ),
  code: (props: React.ComponentProps<"code">) => (
    <code
      className="rounded bg-surface px-1 py-0.5 font-mono text-[0.85em] break-words"
      {...props}
    />
  ),
  pre: (props: React.ComponentProps<"pre">) => (
    <pre
      className="dpas-scroll mb-2 overflow-x-auto rounded-md bg-surface p-2 font-mono text-xs last:mb-0"
      {...props}
    />
  ),
  h1: (props: React.ComponentProps<"h1">) => (
    <p className="mb-1 font-semibold" {...props} />
  ),
  h2: (props: React.ComponentProps<"h2">) => (
    <p className="mb-1 font-semibold" {...props} />
  ),
  h3: (props: React.ComponentProps<"h3">) => (
    <p className="mb-1 font-semibold" {...props} />
  ),
  table: (props: React.ComponentProps<"table">) => (
    <div className="dpas-scroll mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  th: (props: React.ComponentProps<"th">) => (
    <th className="border border-border px-2 py-1 text-left font-medium" {...props} />
  ),
  td: (props: React.ComponentProps<"td">) => (
    <td className="border border-border px-2 py-1" {...props} />
  ),
  hr: () => <hr className="my-2 border-border" />,
  blockquote: (props: React.ComponentProps<"blockquote">) => (
    <blockquote className="mb-2 border-l-2 border-border pl-2 text-muted-foreground last:mb-0" {...props} />
  ),
};

export const MarkdownText = memo(function MarkdownText({ children }: { children: string }) {
  return (
    <div className="dpas-markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </Markdown>
    </div>
  );
});
