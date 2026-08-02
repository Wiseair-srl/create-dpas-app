import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Button. Owns its own variants rather than re-exporting a toolkit's, so the
 * whole app — template chrome included, via the ToolkitProvider `Button`
 * override — uses these variants. Notably `outline` is a bordered field
 * (`border-input bg-background`), not the toolkit's accent-filled pill.
 *
 * Export surface stays compatible with the previous toolkit re-export:
 * `Button`, `ButtonBase`, `buttonVariants`, and the optional `intent` /
 * `emphasis` props are accepted (and ignored) so callers passing them keep
 * type-checking and no unknown attributes leak onto the DOM.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      /* Heights follow the dashboard control rhythm (36 / 32 / 40),
         one step tighter than the shadcn defaults. */
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3",
        lg: "h-10 px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Accepted for drop-in compatibility with shadcn call sites; ignored. */
  intent?: string;
  /** Accepted for drop-in compatibility with shadcn call sites; ignored. */
  emphasis?: string;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, intent: _intent, emphasis: _emphasis, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, Button as ButtonBase, buttonVariants };
