import { FilterX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One-click reset for a table's active filters. Drop it into a `TableToolbar`
 * (via its `onClearFilters`/`hasActiveFilters` props) or a custom toolbar. It
 * renders nothing until a filter is active, so it only shows when there's
 * something to clear.
 */
export function ClearFiltersButton({
  show,
  onClick,
  className,
}: {
  show: boolean;
  onClick: () => void;
  className?: string;
}) {
  if (!show) return null;
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className={cn("text-muted-foreground", className)}>
      <FilterX className="size-4" />
      Clear filters
    </Button>
  );
}
