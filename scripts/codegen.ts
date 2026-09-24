/**
 * bun run codegen — anchor build → IDL → Codama → packages/sdk/src/generated (PLAN §4.3).
 * `--skip-build` reuses the existing IDLs.
 */
import { run } from "./lib/proc";
import { ANCHOR_DIR } from "./lib/toolchain";

if (!process.argv.includes("--skip-build")) {
  await run(["anchor", "build"], { cwd: ANCHOR_DIR });
}
await run(["bunx", "codama", "run", "vault", "-i", "anchor/target/idl/index_vault.json"]);
await run(["bunx", "codama", "run", "market", "-i", "anchor/target/idl/mock_market.json"]);
console.log("[codegen] done");
