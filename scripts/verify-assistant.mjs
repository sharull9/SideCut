#!/usr/bin/env node
// Runs the built assistant (apps/agent/.output) against a scripted model and a stand-in desktop
// host, then checks that host tools run through the shared adapters and that applied edits wait
// for approval. Build first: vp run --filter @sidecut/agent build
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, "apps/agent/.output");
const work = await mkdtemp(join(tmpdir(), "sidecut-assistant-"));

const listen = (server) =>
  new Promise((done) => server.listen(0, "127.0.0.1", () => done(server.address().port)));
const body = async (request) => {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text ? JSON.parse(text) : {};
};

// Stand-in desktop host: answers the same /v1/<operation> API as LocalHTTPService.
const hostToken = randomBytes(32).toString("hex");
const hostCalls = [];
const host = createServer(async (request, response) => {
  assert.equal(request.headers.authorization, `Bearer ${hostToken}`);
  const operation = new URL(request.url, "http://host").pathname.replace("/v1/", "");
  hostCalls.push({
    operation,
    input: await body(request),
    author: request.headers["x-tandem-author"],
  });
  response.setHeader("content-type", "application/json");
  if (operation === "status")
    response.end(
      JSON.stringify({
        projectID: "p1",
        name: "Launch video",
        revision: 42,
        clipCount: 14,
        duration: 151,
        saveState: "saved",
      }),
    );
  else response.end(JSON.stringify({ revision: 43, removed: 11 }));
});
const hostPort = await listen(host);
const apiFile = join(work, "api.json");
await writeFile(apiFile, JSON.stringify({ port: hostPort, token: hostToken }));

// Scripted OpenAI-compatible model: the user's message picks which tool it calls.
const model = createServer(async (request, response) => {
  const { messages } = await body(request);
  const user = messages.findLast((m) => m.role === "user");
  const userText = typeof user.content === "string" ? user.content : JSON.stringify(user.content);
  const toolResult = messages.findLast((m) => m.role === "tool");
  response.setHeader("content-type", "text/event-stream");
  const send = (delta, finish = null) =>
    response.write(
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "mock", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
    );
  if (toolResult) {
    send({
      role: "assistant",
      content: `Done. Host said: ${String(toolResult.content).slice(0, 200)}`,
    });
    send({}, "stop");
  } else {
    const call = userText.includes("tighten")
      ? { name: "tighten", arguments: JSON.stringify({ apply: true, expectedRevision: 42 }) }
      : { name: "status", arguments: "{}" };
    send({
      role: "assistant",
      tool_calls: [{ index: 0, id: "call_1", type: "function", function: call }],
    });
    send({}, "tool_calls");
  }
  response.write(
    `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "mock", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`,
  );
  response.end("data: [DONE]\n\n");
});
const modelPort = await listen(model);

const probe = createServer();
const agentPort = await listen(probe);
await new Promise((done) => probe.close(done));
const token = randomBytes(32).toString("hex");
const baseUrl = `http://127.0.0.1:${agentPort}`;
const child = spawn(process.execPath, [join(output, "server/index.mjs")], {
  cwd: output,
  env: {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    TEMP: process.env.TEMP,
    HOST: "127.0.0.1",
    PORT: String(agentPort),
    OPENROUTER_API_KEY: "test",
    OPENROUTER_BASE_URL: `http://127.0.0.1:${modelPort}/api/v1`,
    SIDECUT_AGENT_PROVIDER: "openrouter",
    SIDECUT_AGENT_MODEL: "mock/model",
    SIDECUT_AGENT_TOKEN: token,
    SIDECUT_API_FILE: apiFile,
    WORKFLOW_LOCAL_DATA_DIR: join(work, "data"),
    WORKFLOW_LOCAL_BASE_URL: baseUrl,
    EVE_SCHEDULES_DISABLED: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (chunk) => (log += chunk));
child.stderr.on("data", (chunk) => (log += chunk));

const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
async function turn(message) {
  const created = await fetch(`${baseUrl}/eve/v1/session`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message }),
  }).then((r) => r.json());
  assert.ok(created.sessionId, `No session: ${JSON.stringify(created)}`);
  const stream = await fetch(`${baseUrl}/eve/v1/session/${created.sessionId}/stream`, { headers });
  const events = [];
  let pending = "";
  const decoder = new TextDecoder();
  for await (const chunk of stream.body) {
    pending += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (!line) continue;
      // Each stream line carries recorded `facts`; progress and heartbeats carry none.
      for (const fact of JSON.parse(line).facts ?? []) {
        events.push(fact);
        if (["turn.settled", "turn.paused", "turn.failed"].includes(fact.type))
          return { sessionId: created.sessionId, events };
        if (fact.type === "interaction.requested") return { sessionId: created.sessionId, events };
      }
    }
  }
  return { sessionId: created.sessionId, events };
}

try {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      if ((await fetch(`${baseUrl}/eve/v1/health`)).ok) break;
    } catch {}
    assert.ok(Date.now() < deadline, `Assistant did not start:\n${log}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const denied = await fetch(`${baseUrl}/eve/v1/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "hi" }),
  });
  assert.equal(denied.status, 401, "Sessions must require the desktop token.");
  // The renderer calls from sidecut://app with eve's own headers, so preflight must allow them.
  const preflight = await fetch(`${baseUrl}/eve/v1/session`, {
    method: "OPTIONS",
    headers: {
      origin: "sidecut://app",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization,content-type,x-eve-stream-version",
    },
  });
  assert.ok(preflight.ok, `Preflight failed: ${preflight.status}`);
  assert.ok(preflight.headers.get("access-control-allow-origin"), "Preflight must allow the app.");
  const allowed = (preflight.headers.get("access-control-allow-headers") ?? "").toLowerCase();
  for (const header of ["authorization", "x-eve-stream-version"])
    assert.ok(allowed === "*" || allowed.includes(header), `Preflight must allow ${header}.`);

  const read = await turn("What's in my project?");
  const types = read.events.map((e) => e.type);
  assert.ok(
    types.includes("turn.settled"),
    `Read turn did not settle: ${types.join(", ")}\n${log}`,
  );
  assert.deepEqual(
    hostCalls.map((c) => [c.operation, c.author]),
    [["status", "assistant"]],
  );
  const text = JSON.stringify(read.events);
  assert.match(text, /Launch video/, "The model should see the host's readable status text.");

  hostCalls.length = 0;
  const edit = await turn("Please tighten the pauses");
  const editTypes = edit.events.map((e) => e.type);
  if (process.env.DUMP)
    console.log(edit.events.map((e) => JSON.stringify(e).slice(0, 400)).join("\n"));
  assert.ok(
    editTypes.some((type) => type === "turn.paused" || type === "interaction.requested"),
    `Applied edit should wait for approval: ${editTypes.join(", ")}`,
  );
  assert.equal(hostCalls.length, 0, "An unapproved edit must not reach the host.");

  const opened = edit.events.find((e) => e.type === "interaction.opened");
  const answered = await fetch(`${baseUrl}/eve/v1/session/${edit.sessionId}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      answers: [{ interactionId: opened.data.interactionId, optionId: "approve" }],
    }),
  });
  assert.ok(answered.ok, `Approval was not accepted: ${answered.status}`);
  const approvedBy = Date.now() + 15_000;
  while (!hostCalls.length && Date.now() < approvedBy) await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(
    hostCalls.map((c) => [c.operation, c.input.apply, c.input.expectedRevision]),
    [["tighten", true, 42]],
    "An approved edit runs once, with the model's revision guard.",
  );
  console.log(
    "Assistant verification passed: host tools run, applied edits wait for approval, approved edits run once.",
  );
} finally {
  child.kill();
  host.close();
  model.close();
  await new Promise((r) => setTimeout(r, 500));
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
