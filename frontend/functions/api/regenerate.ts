import { Env, json, readJson, signAndForward, isNonEmptyString } from "./_shared";

// POST /api/regenerate
// Frozen payload: {"account_id":"","mode":"angle|instruction","angle":"","instruction":""}

const ANGLES = ["cost", "speed", "risk", "talent", "competition"];

function validate(data: any): string | null {
  if (!data || typeof data !== "object") return "body must be an object";
  if (!isNonEmptyString(data.account_id)) return "missing/empty `account_id`";
  if (data.mode !== "angle" && data.mode !== "instruction")
    return "`mode` must be 'angle' or 'instruction'";
  if (data.mode === "angle") {
    if (!isNonEmptyString(data.angle)) return "mode 'angle' requires a non-empty `angle`";
    if (!ANGLES.includes(data.angle)) return `\`angle\` must be one of: ${ANGLES.join(", ")}`;
  }
  if (data.mode === "instruction") {
    if (!isNonEmptyString(data.instruction))
      return "mode 'instruction' requires a non-empty `instruction`";
  }
  // Optional cross-field type checks (frozen shape carries both keys).
  if (data.angle != null && typeof data.angle !== "string") return "`angle` must be a string";
  if (data.instruction != null && typeof data.instruction !== "string")
    return "`instruction` must be a string";
  return null;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const [parsed, err] = await readJson(request);
  if (err) return err;
  const { raw, data } = parsed!;

  const problem = validate(data);
  if (problem) return json({ error: "invalid_payload", detail: problem }, 400);

  return signAndForward(env, "regenerate", raw, env.HERMES_REGENERATE_URL);
};
