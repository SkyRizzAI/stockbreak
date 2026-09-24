import { ROOT, toolchainEnv } from "./toolchain";

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Return output instead of inheriting stdio. */
  capture?: boolean;
  /** Do not throw on non-zero exit. */
  allowFail?: boolean;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command with the pinned toolchain on PATH. */
export async function run(cmd: string[], opts: RunOptions = {}): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? ROOT,
    env: toolchainEnv(opts.env),
    stdout: opts.capture ? "pipe" : "inherit",
    stderr: opts.capture ? "pipe" : "inherit",
    stdin: "ignore",
  });
  const [stdout, stderr] = opts.capture
    ? await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
    : ["", ""];
  const code = await proc.exited;
  if (code !== 0 && !opts.allowFail) {
    throw new Error(`Command failed (${code}): ${cmd.join(" ")}\n${stderr}`);
  }
  return { code, stdout, stderr };
}

/** Run and return trimmed stdout, or null when the command is missing / fails. */
export async function tryOutput(cmd: string[], cwd?: string): Promise<string | null> {
  try {
    const r = await run(cmd, { capture: true, allowFail: true, cwd });
    return r.code === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

export function log(scope: string, msg: string): void {
  console.log(`[${scope}] ${msg}`);
}
