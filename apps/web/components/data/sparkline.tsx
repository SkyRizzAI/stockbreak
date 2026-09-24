import { cn } from "cn";

export function Sparkline({
  data,
  width = 96,
  height = 28,
  className,
}: {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (data.length < 2)
    return (
      <div style={{ width, height }} className={cn("text-xs text-muted-foreground", className)} />
    );
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map(
    (v, i) =>
      `${(i / (data.length - 1)) * width},${height - 2 - ((v - min) / span) * (height - 4)}`,
  );
  const up = (data.at(-1) ?? 0) >= (data[0] ?? 0);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn(up ? "text-up" : "text-down", className)}
      aria-hidden
    >
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
