// OpenNext for Cloudflare (docs/DEPLOY.md "Opsi C"). No incremental cache: pages are
// dynamic (SSR) and the data lives in Postgres.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
