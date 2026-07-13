import { Env, json, readJson, signAndForward, isNonEmptyString } from "./_shared";

// POST /api/run-factory
// Frozen payload: {"rows":[{company,domain,contact_title,vertical,contact_name?,notes?}]}

const REQUIRED = ["company", "domain", "contact_title", "vertical"] as const;

function validate(data: any): string | null {
  if (!data || typeof data !== "object") return "body must be an object";
  if (!Array.isArray(data.rows)) return "`rows` must be an array";
  if (data.rows.length === 0) return "`rows` is empty";
  if (data.rows.length > 500) return "`rows` exceeds 500";
  for (let i = 0; i < data.rows.length; i++) {
    const r = data.rows[i];
    if (!r || typeof r !== "object") return `row ${i} is not an object`;
    for (const key of REQUIRED) {
      if (!isNonEmptyString(r[key])) return `row ${i}: missing/empty "${key}"`;
    }
    if (r.contact_name != null && typeof r.contact_name !== "string")
      return `row ${i}: contact_name must be a string`;
    if (r.notes != null && typeof r.notes !== "string")
      return `row ${i}: notes must be a string`;
  }
  return null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const [parsed, err] = await readJson(request);
  if (err) return err;
  const { raw, data } = parsed!;

  const problem = validate(data);
  if (problem) return json({ error: "invalid_payload", detail: problem }, 400);

  return signAndForward(env, "run-factory", raw, env.HERMES_RUN_FACTORY_URL);
};
