import { getIndex, latestSnapshot, sharePricesAt } from "@repo/db";
import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/env";
import { db } from "@/lib/server/ctx";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Index card";

// Four greens of the index mark (refs "Index mark").
const shades = ["#d6f5e6", "#8fddb8", "#4fb58a", "#2a7a5c"];

export default async function Image({ params }: { params: Promise<{ pubkey: string }> }) {
  const { pubkey } = await params;
  let name = "Index";
  let symbol = "";
  let price = 0;
  let ret30: number | null = null;
  let assets: { symbol: string; targetWeightBps: number }[] = [];
  try {
    const row = await getIndex(db(), pubkey);
    if (row) {
      name = row.name;
      symbol = row.symbol;
      assets = (row.assets as { symbol: string; targetWeightBps: number }[]) ?? [];
      const snap = await latestSnapshot(db(), pubkey);
      price = Number(snap?.sharePriceMicroUsd ?? 0n) / 1e6;
      const then = (await sharePricesAt(db(), new Date(Date.now() - 30 * 86_400_000))).get(pubkey);
      if (snap && then) ret30 = Number(snap.sharePriceMicroUsd) / Number(then) - 1;
    }
  } catch {
    // render a generic card
  }
  const total = assets.reduce((a, x) => a + x.targetWeightBps, 0) || 1;
  const retColor = ret30 === null ? "#9bb3a7" : ret30 >= 0 ? "#4bf0a9" : "#ff8a7a";
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#06140e",
        color: "#e8f3ec",
        padding: 64,
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 28,
          color: "#9bb3a7",
        }}
      >
        <span>{APP_NAME}</span>
        <span
          style={{
            border: "2px solid #1c3329",
            borderRadius: 8,
            padding: "4px 14px",
            fontSize: 22,
          }}
        >
          Simulated
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 56 }}>
        <span style={{ fontSize: 72, fontWeight: 600, letterSpacing: -2 }}>{name}</span>
        <span style={{ fontSize: 32, color: "#9bb3a7", marginTop: 4 }}>{symbol}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 32, marginTop: 40 }}>
        <span style={{ fontSize: 88, fontWeight: 500 }}>${price.toFixed(4)}</span>
        <span style={{ fontSize: 40, color: retColor }}>
          {ret30 === null ? "" : `${ret30 >= 0 ? "+" : ""}${(ret30 * 100).toFixed(2)}% 30d`}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          height: 28,
          borderRadius: 14,
          overflow: "hidden",
          width: "100%",
        }}
      >
        {assets.map((a, i) => (
          <div
            key={a.symbol}
            style={{
              width: `${(a.targetWeightBps / total) * 100}%`,
              background: shades[i % shades.length],
              height: "100%",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: 28, marginTop: 16, fontSize: 24, color: "#9bb3a7" }}>
        {assets.slice(0, 8).map((a) => (
          <span key={a.symbol}>
            {a.symbol} {(a.targetWeightBps / 100).toFixed(0)}%
          </span>
        ))}
      </div>
    </div>,
    size,
  );
}
