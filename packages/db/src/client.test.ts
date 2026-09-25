import { afterEach, expect, test } from "bun:test";
import { connectionOptions } from "./client";

const saved = { VERCEL: process.env.VERCEL, DATABASE_POOL_MAX: process.env.DATABASE_POOL_MAX };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("local postgres keeps the defaults", () => {
  delete process.env.VERCEL;
  delete process.env.DATABASE_POOL_MAX;
  const c = connectionOptions("postgres://postgres:postgres@localhost:5434/app");
  expect(c.options).toEqual({ max: 10 });
  expect(c.url).toBe("postgres://postgres:postgres@localhost:5434/app");
});

test("neon pooled url: tls kept, channel_binding dropped, no prepared statements", () => {
  delete process.env.VERCEL;
  const c = connectionOptions(
    "postgresql://u:p@ep-x-123-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  );
  expect(c.url).not.toContain("channel_binding");
  expect(c.url).toContain("sslmode=require");
  expect(c.options.prepare).toBe(false);
  expect(c.options.ssl).toBeUndefined(); // sslmode in the URL decides
});

test("hosted url without sslmode requires tls; serverless uses a small pool", () => {
  process.env.VERCEL = "1";
  delete process.env.DATABASE_POOL_MAX;
  const c = connectionOptions("postgresql://u:p@ep-x-123.eu-central-1.aws.neon.tech/neondb");
  expect(c.options.ssl).toBe("require");
  expect(c.options.max).toBe(3);
  expect(c.options.idle_timeout).toBe(20);
  expect(c.options.prepare).toBeUndefined();
});

test("DATABASE_POOL_MAX overrides the pool size", () => {
  process.env.DATABASE_POOL_MAX = "5";
  expect(connectionOptions("postgres://a@localhost/app").options.max).toBe(5);
});

test("private hosts stay plain; transaction poolers drop prepared statements", () => {
  for (const h of ["192.168.1.5", "10.0.0.2", "172.17.0.1", "host.docker.internal", "pg.orb.local"])
    expect(connectionOptions(`postgres://u:p@${h}:5432/app`).options.ssl).toBeUndefined();
  expect(
    connectionOptions("postgres://u:p@aws-0-eu.pooler.supabase.com:6543/postgres").options.prepare,
  ).toBe(false);
});
