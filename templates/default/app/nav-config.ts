/**
 * The shell's map of itself: sections for the rail, leaves for the sub-nav.
 *
 * One declaration, several readers — the sidebar renders it, the page title
 * comes from it, and `view:app.navigation` turns it into the route list the
 * agent may move between. A route that is not here is a route the agent cannot
 * navigate to, which is the intended ceiling rather than an oversight.
 */

export interface NavLeaf {
  label: string;
  path: string;
}

export interface NavGroup {
  label?: string;
  items: NavLeaf[];
}

export interface NavSection {
  key: string;
  label: string;
  basePath: string;
  groups: NavGroup[];
}

export const SECTIONS: NavSection[] = [
  {
    key: "receivables",
    label: "Receivables",
    basePath: "/receivables",
    groups: [
      {
        items: [
          { label: "Pending invoices", path: "/receivables/pending" },
          { label: "All invoices", path: "/receivables/all" },
          { label: "Clients", path: "/receivables/clients" },
        ],
      },
    ],
  },
  {
    key: "architecture",
    label: "Architecture",
    basePath: "/architecture",
    groups: [{ items: [{ label: "How this works", path: "/architecture" }] }],
  },
];

export function sectionForPath(pathname: string): NavSection | null {
  return (
    SECTIONS.find((s) => pathname === s.basePath || pathname.startsWith(`${s.basePath}/`)) ?? null
  );
}

export function leafForPath(pathname: string): NavLeaf | null {
  for (const section of SECTIONS) {
    for (const group of section.groups) {
      const leaf = group.items.find((item) => item.path === pathname);
      if (leaf) return leaf;
    }
  }
  return null;
}
