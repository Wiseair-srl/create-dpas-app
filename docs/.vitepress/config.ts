import { defineConfig } from "vitepress";
import type MarkdownIt from "markdown-it";

/**
 * Several pages are `@include`s of markdown that ships inside every generated
 * app (`templates/default/docs/*.md`). Those files link to application source
 * with paths like `../src/agent/host/protocol.ts`, which mean nothing on a
 * website. This plugin resolves them:
 *
 *  - with `DOCS_REPO_URL` set, they become links into the repository;
 *  - without it, they degrade to inline code — the path is the useful part,
 *    and no page ever ships a broken link.
 */
const REPO_URL = (process.env.DOCS_REPO_URL ?? "").replace(/\/+$/, "");
const REPO_BRANCH = process.env.DOCS_REPO_BRANCH ?? "main";

/** Where the nav icons point. `REPO_URL` is only set in CI, so the GitHub icon
 *  needs a home of its own or it disappears from every local build. */
const GITHUB_URL = REPO_URL || "https://github.com/Wiseair-srl/create-dpas-app";
const NPM_URL = "https://www.npmjs.com/package/create-dpas-app";

/**
 * Inline simple-icons marks. A named `icon` would make VitePress fetch it from
 * api.iconify.design during the build, so the docs would need the network to
 * render their own chrome.
 */
const GITHUB_ICON =
  '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>';
const NPM_ICON =
  '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z"/></svg>';

/**
 * `../app/x` in an app-shipped doc → `app/x` in the reader's generated app.
 * The alternation is the template's own top-level source directories; a link to
 * anything else is left alone rather than guessed at.
 */
const APP_SOURCE = /^(?:\.\.\/)+((?:app|server|capabilities|e2e|scripts)\/.+)$/;

/** Root markdown served by wrapper pages under /project. */
const ROOT_FILE_PAGES: [RegExp, string][] = [
  [/^(?:\.\.\/)*CONTRIBUTING\.md$/, "/project/contributing"],
  [/^(?:\.\.\/)*SECURITY\.md$/, "/project/security-policy"],
  [/^(?:\.\.\/)*CODE_OF_CONDUCT\.md$/, "/project/code-of-conduct"],
  [/^(?:\.\.\/)*README\.md$/, "/"],
];

function resolveHref(href: string): { href: string } | { code: string } | undefined {
  for (const [pattern, replacement] of ROOT_FILE_PAGES) {
    if (pattern.test(href)) return { href: replacement };
  }
  const appSource = APP_SOURCE.exec(href);
  if (appSource?.[1]) {
    const relative = appSource[1];
    if (!REPO_URL) return { code: relative };
    const kind = relative.endsWith("/") ? "tree" : "blob";
    return { href: `${REPO_URL}/${kind}/${REPO_BRANCH}/templates/default/${relative}` };
  }
  return undefined;
}

function rewriteAppLinks(md: MarkdownIt): void {
  md.core.ruler.push("dpas-app-links", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "inline" || !token.children) continue;

      const rewritten: typeof token.children = [];
      for (let i = 0; i < token.children.length; i++) {
        const child = token.children[i]!;
        if (child.type !== "link_open") {
          rewritten.push(child);
          continue;
        }

        const resolved = resolveHref(child.attrGet("href") ?? "");
        if (!resolved) {
          rewritten.push(child);
          continue;
        }
        if ("href" in resolved) {
          child.attrSet("href", resolved.href);
          rewritten.push(child);
          continue;
        }

        // Collapse `[label](../src/x)` into a `src/x` code span. Links never
        // nest, so everything up to the next link_close is the label.
        let end = i + 1;
        while (end < token.children.length && token.children[end]!.type !== "link_close") end++;
        const code = new state.Token("code_inline", "code", 0);
        code.content = resolved.code;
        code.markup = "`";
        rewritten.push(code);
        i = end;
      }
      token.children = rewritten;
    }
  });
}

const SITE_TITLE = "create-dpas-app";
const SITE_DESCRIPTION =
  "Scaffold a Dual-Plane Agent Stack application: an assistant that operates your product through governed capabilities, never the DOM.";

export default defineConfig({
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/logo.svg" }],
    ["meta", { name: "theme-color", content: "#2563eb" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: SITE_TITLE }],
    ["meta", { property: "og:description", content: SITE_DESCRIPTION }],
  ],

  markdown: {
    config: rewriteAppLinks,
  },

  themeConfig: {
    logo: "/logo.svg",
    siteTitle: SITE_TITLE,

    search: {
      provider: "local",
      options: { detailedView: true },
    },

    outline: { level: [2, 3], label: "On this page" },

    nav: [
      {
        text: "Guide",
        link: "/getting-started",
        activeMatch: "^/(getting-started|concepts|guides)",
      },
      { text: "Reference", link: "/reference/cli", activeMatch: "^/reference/" },
      { text: "Security", link: "/security/model", activeMatch: "^/security/" },
      {
        text: "Project",
        activeMatch: "^/(project|adr)/",
        items: [
          { text: "Repository and gates", link: "/project/repository" },
          { text: "Decision records", link: "/project/decisions" },
          { text: "Contributing", link: "/project/contributing" },
          { text: "Security policy", link: "/project/security-policy" },
          { text: "Code of conduct", link: "/project/code-of-conduct" },
        ],
      },
    ],

    socialLinks: [
      { icon: { svg: GITHUB_ICON }, link: GITHUB_URL, ariaLabel: "GitHub" },
      { icon: { svg: NPM_ICON }, link: NPM_URL, ariaLabel: "npm" },
    ],

    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Getting started", link: "/getting-started" },
          { text: "The dual-plane model", link: "/concepts/dual-plane" },
          { text: "Anatomy of a capability", link: "/concepts/capabilities" },
          { text: "Architecture", link: "/concepts/architecture" },
        ],
      },
      {
        text: "Guides",
        collapsed: false,
        items: [
          { text: "Adding a capability", link: "/guides/adding-a-capability" },
          { text: "Connecting a model", link: "/guides/connecting-a-model" },
          { text: "Testing without an LLM", link: "/guides/testing" },
          { text: "Deploying", link: "/guides/deploying" },
        ],
      },
      {
        text: "Reference",
        collapsed: false,
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "Project structure", link: "/reference/project-structure" },
          { text: "Configuration", link: "/reference/configuration" },
          { text: "Host protocol", link: "/reference/host-protocol" },
          { text: "Error codes", link: "/reference/errors" },
        ],
      },
      {
        text: "Security",
        collapsed: false,
        items: [
          { text: "Security model", link: "/security/model" },
          { text: "Scaffolder guarantees", link: "/security/scaffolder" },
        ],
      },
      {
        text: "Project",
        collapsed: true,
        items: [
          { text: "Repository and gates", link: "/project/repository" },
          { text: "Decision records", link: "/project/decisions" },
          { text: "Contributing", link: "/project/contributing" },
          { text: "Security policy", link: "/project/security-policy" },
          { text: "Code of conduct", link: "/project/code-of-conduct" },
        ],
      },
      {
        text: "Decision records",
        collapsed: true,
        items: [
          { text: "ADR-0001 · Published DPAS packages", link: "/adr/0001-published-dpas-packages" },
          {
            text: "ADR-0002 · Application-owned host protocol",
            link: "/adr/0002-host-protocol-over-react-ai-sdk",
          },
          { text: "ADR-0003 · AI SDK v5 line", link: "/adr/0003-ai-sdk-v5-line" },
          { text: "ADR-0004 · Embedded JSON store", link: "/adr/0004-embedded-json-store" },
          {
            text: "ADR-0005 · Confirmation between steps",
            link: "/adr/0005-confirmation-wait-between-steps",
          },
          {
            text: "ADR-0006 · Scripted model in CI",
            link: "/adr/0006-scripted-model-for-live-path-ci",
          },
          {
            text: "ADR-0007 · Demo identity cookie",
            link: "/adr/0007-demo-identity-signed-cookie",
          },
          {
            text: "ADR-0008 · Runtime model credentials",
            link: "/adr/0008-runtime-model-credentials",
          },
          {
            text: "ADR-0009 · Orphaned server tool calls",
            link: "/adr/0009-orphaned-server-tool-calls",
          },
          {
            text: "ADR-0010 · Approvals over confirmations",
            link: "/adr/0010-approvals-over-confirmations",
          },
          {
            text: "ADR-0011 · Compiled capability contracts",
            link: "/adr/0011-compiled-capability-contracts",
          },
        ],
      },
    ],

    footer: {
      message: "Built on Agent Surface, oRPC Agent, Mastra and assistant-ui.",
      copyright: "Released under the MIT License.",
    },

    docFooter: { prev: "Previous", next: "Next" },
  },
});
