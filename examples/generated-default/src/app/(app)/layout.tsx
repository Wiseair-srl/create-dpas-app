import { NavRail } from "@/components/app-shell/nav-rail";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
