import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const dir = new URL("../sites/upgrad-com-ceo/", import.meta.url);
const accountId = "upgrad-com-ceo";
const liveUrl = `https://${accountId}.pages.dev`;
const read = (name) => readFile(new URL(name, dir));
const json = async (name) => JSON.parse(await read(name));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

async function accountDetail() {
  const response = await fetch("https://enchanted-stingray-115.convex.cloud/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      path: "queries:accountDetail",
      args: { account_id: accountId },
      format: "json",
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.status, "success");
  return payload.value;
}

test("upGrad CEO research packet satisfies the QA contract", async () => {
  const [research, qa] = await Promise.all([json("research.json"), json("qa-research.json")]);
  assert.equal(research.company, "upGrad");
  assert.equal(research.reader_lens, "financial");
  assert.ok(research.confidence >= 0.5);
  assert.ok(research.findings.length >= 5);
  assert.ok(research.findings.every(({ source_url }) => /^https:\/\//.test(source_url)));
  assert.ok(research.findings.filter(({ hook_strength }) => hook_strength >= 3).length >= 3);
  assert.equal(qa.pass, true);
});

test("upGrad CEO build artifact satisfies the microsite contract", async () => {
  const [htmlBuffer, build, research, qa] = await Promise.all([
    read("index.html"), json("build.json"), json("research.json"), json("qa-build.json"),
  ]);
  const html = htmlBuffer.toString();
  assert.equal(build.html_path, `sites/${accountId}/index.html`);
  assert.ok(build.word_count >= 250 && build.word_count <= 400);
  assert.ok(build.claims_cited >= 3);
  assert.ok(build.angle_log.because_findings.every((index) => research.findings[index]));
  assert.equal((html.match(/<a\b[^>]*\bdata-cta\b/gi) || []).length, 1);
  assert.match(html, new RegExp(accountId));
  assert.match(html, /https:\/\/enchanted-stingray-115\.convex\.site\/beacon/);
  assert.match(html, /Prepared for upGrad by Meridian AI/);
  assert.doesNotMatch(html, /\{\{|\{Company\}/);
  assert.equal(qa.pass, true);
});

test("upGrad CEO deployment is live, byte-identical, traced, and shipped", async () => {
  const [localHtml, marker, qa, live, detail] = await Promise.all([
    read("index.html"), read(".deployed"), json("qa-deploy.json"), fetch(`${liveUrl}/`), accountDetail(),
  ]);
  assert.equal(marker.toString().trim(), liveUrl);
  assert.equal(qa.pass, true);
  assert.equal(live.status, 200);
  assert.equal(sha256(Buffer.from(await live.arrayBuffer())), sha256(localHtml));
  assert.equal(detail.fleet.status, "shipped");
  assert.equal(detail.fleet.url, liveUrl);
  assert.ok(detail.event_counts.view >= 1);
  assert.deepEqual(
    detail.traces.map(({ stage, verdict }) => [stage, verdict.pass]),
    [["research", true], ["build", true], ["deploy", true]],
  );
});
