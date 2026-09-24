"use client";
/**
 * Numeric text field that lets people type freely ("12.", empty while editing)
 * and only commits valid numbers. Shows the committed value when not focused.
 */
import type { ComponentProps } from "react";
import { useState } from "react";
import { Input } from "@/components/ui/input";

export function DecimalInput({
  value,
  onCommit,
  ...props
}: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      {...props}
      inputMode="decimal"
      value={draft ?? String(value)}
      onFocus={(e) => {
        setDraft(String(value));
        props.onFocus?.(e);
      }}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.]/g, "");
        setDraft(t);
        const n = Number(t);
        if (t !== "" && !t.endsWith(".") && Number.isFinite(n)) onCommit(n);
      }}
      onBlur={(e) => {
        setDraft(null);
        props.onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        props.onKeyDown?.(e);
      }}
    />
  );
}
