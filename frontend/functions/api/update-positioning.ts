import { Env, json, readJson, signAndForward, isNonEmptyString } from "./_shared";

// POST /api/update-positioning
// Frozen payload:
// {"one_liner":"","proof_points":[{"tag":"technical|roi|gtm","text":""}],
//  "tone_rules":[],"forbidden_claims":[],"verticals":[]}

const TAGS = ["technical", "roi", "gtm"];

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validate(data: any): string | null {
  if (!data || typeof data !== "object") return "body must be an object";
  if (!isNonEmptyString(data.one_liner)) return "missing/empty `one_liner`";

  if (!Array.isArray(data.proof_points)) return "`proof_points` must be an array";
  if (data.proof_points.length !== 3) return "`proof_points` must contain exactly 3 items";
  for (let i = 0; i < data.proof_points.length; i++) {
    const p = data.proof_points[i];
    if (!p || typeof p !== "object") return `proof_points[${i}] is not an object`;
    if (!TAGS.includes(p.tag)) return `proof_points[${i}].tag must be one of: ${TAGS.join(", ")}`;
    if (!isNonEmptyString(p.text)) return `proof_points[${i}].text is missing/empty`;
  }

  if (!isStringArray(data.tone_rules)) return "`tone_rules` must be an array of strings";
  if (!isStringArray(data.forbidden_claims))
    return "`forbidden_claims` must be an array of strings";
  if (!isStringArray(data.verticals)) return "`verticals` must be an array of strings";
  return null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const [parsed, err] = await readJson(request);
  if (err) return err;
  const { raw, data } = parsed!;

  const problem = validate(data);
  if (problem) return json({ error: "invalid_payload", detail: problem }, 400);

  return signAndForward(env, "update-positioning", raw, env.HERMES_UPDATE_POSITIONING_URL);
};
