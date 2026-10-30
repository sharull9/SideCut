import { spawn } from "node:child_process";
import { resolve } from "node:path";

const child = spawn(
  process.execPath,
  [
    resolve("node_modules/vite-plus/bin/vp"),
    "test",
    "run",
    "apps/desktop/src/main/native-streaming.test.ts",
  ],
  { windowsHide: true, stdio: "inherit", env: { ...process.env, SIDECUT_STREAM_EVIDENCE: "1" } },
);
const timer = setTimeout(() => child.kill(), 120000);
child.on("error", () => {
  process.exitCode = 1;
});
child.on("close", (code) => {
  clearTimeout(timer);
  process.exitCode = code ?? 1;
});
