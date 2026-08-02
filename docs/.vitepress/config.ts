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

/** `../src/x` in an app-shipped doc → `src/x` in the reader's generated app. */
const APP_SOURCE = /^(?:\.\.\/)+(src\/.+)$/;

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

  // Internal build artifacts that live in docs/ but are not site pages.
  srcExclude: ["implementation-plan.md", "final-report.md"],

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
      {
        text: "npm",
        link: "https://www.npmjs.com/package/create-dpas-app",
      },
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
          { text: "Security and confirmation", link: "/security/model" },
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
