/** bun run test:program — build both Anchor programs and run LiteSVM tests (A12). */
import { run } from "./lib/proc";
import { ANCHOR_DIR } from "./lib/toolchain";

await run(["anchor", "build"], { cwd: ANCHOR_DIR });
await run(["cargo", "test"], { cwd: ANCHOR_DIR });
