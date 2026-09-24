import type { VariantProps } from "class-variance-authority";
import Link from "next/link";
import type { ComponentProps } from "react";
import { Button, type buttonVariants } from "@/components/ui/button";

/** Button styled link (Base UI needs nativeButton=false for non-button elements). */
export function LinkButton({
  href,
  children,
  ...props
}: { href: string } & VariantProps<typeof buttonVariants> &
  Omit<ComponentProps<typeof Button>, "render" | "nativeButton">) {
  return (
    <Button nativeButton={false} render={<Link href={href} />} {...props}>
      {children}
    </Button>
  );
}
