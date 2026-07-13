import { useState } from "react";
import css from "./GtmPlanner.module.css";
import { updatePositioning } from "../lib/factoryApi";
import { useToast } from "../components/Toast";
import type { ProofTag, Positioning } from "../lib/types";

const TAGS: ProofTag[] = ["technical", "roi", "gtm"];

/* ---------- reusable list editor ---------- */
function ListEditor({
  items,
  onChange,
  placeholder,
  variant,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  variant?: "forbid";
}) {
  const [draft, setDraft] = useState("");
  function add() {
    const v = draft.trim();
    if (!v) return;
    if (!items.includes(v)) onChange([...items, v]);
    setDraft("");
  }
  return (
    <div className={css.listEd}>
      {items.length > 0 ? (
        <div className={css.chips}>
          {items.map((it, i) => (
            <span key={i} className={`${css.chip} ${variant === "forbid" ? css.forbid : ""}`}>
              {it}
              <button
                className={css.chipX}
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                aria-label={`Remove ${it}`}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className={css.chips}>
          <span className={css.emptyList}>none yet</span>
        </div>
      )}
      <div className={css.listInputRow}>
        <input
          className={css.listInput}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <span className={css.enterHint}>↵ ENTER TO ADD</span>
      </div>
    </div>
  );
}

const EXAMPLE: Positioning = {
  one_liner: "Research-grade personalization at volume — a microsite per account that proves you understand their world.",
  proof_points: [
    { tag: "technical", text: "Every claim on the page is cited to a real, dated source the QA gate spot-checks." },
    { tag: "roi", text: "20 researched sites shipped in under 90 minutes, under $2 each." },
    { tag: "gtm", text: "Reader-lens per contact title — the CTO and the CFO see different pages." },
  ],
  tone_rules: ["Active voice", "Sentence case", "Speak about them, not us", "One named CTA"],
  forbidden_claims: ["#1 in the market", "guaranteed ROI", "enterprise-grade (unearned)"],
  verticals: ["Fintech", "Dev Tools", "Digital Health", "Industrial Automation"],
};

export function GtmPlanner() {
  const toast = useToast();
  const [oneLiner, setOneLiner] = useState("");
  const [proofs, setProofs] = useState<{ tag: ProofTag; text: string }[]>([
    { tag: "technical", text: "" },
    { tag: "roi", text: "" },
    { tag: "gtm", text: "" },
  ]);
  const [tone, setTone] = useState<string[]>([]);
  const [forbidden, setForbidden] = useState<string[]>([]);
  const [verticals, setVerticals] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const proofsFilled = proofs.every((p) => p.text.trim().length > 0);
  const ready = oneLiner.trim().length > 0 && proofsFilled;

  function setProof(i: number, patch: Partial<{ tag: ProofTag; text: string }>) {
    setProofs((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  function loadExample() {
    setOneLiner(EXAMPLE.one_liner);
    setProofs(EXAMPLE.proof_points.map((p) => ({ ...p })));
    setTone([...EXAMPLE.tone_rules]);
    setForbidden([...EXAMPLE.forbidden_claims]);
    setVerticals([...EXAMPLE.verticals]);
  }

  async function save() {
    if (!ready) return;
    setSaving(true);
    const payload: Positioning = {
      one_liner: oneLiner.trim(),
      proof_points: proofs.map((p) => ({ tag: p.tag, text: p.text.trim() })),
      tone_rules: tone,
      forbidden_claims: forbidden,
      verticals,
    };
    const res = await updatePositioning(payload);
    setSaving(false);
    if (res.ok) {
      toast("ok", <><strong>Brief filed.</strong> The agency's positioning memory is updated — every future build honors it.</>);
    } else {
      toast("err", <><strong>Couldn't file the brief.</strong> {res.error}{res.detail ? ` — ${res.detail}` : ""}</>);
    }
  }

  return (
    <div className={css.wrap}>
      <div className={css.masthead}>
        <div>
          <h1>Brief your agency</h1>
          <p>
            This is the only place the factory learns what you sell. Everything on every microsite is
            drawn from this brief — the builder can never invent a capability you didn't write here.
          </p>
        </div>
        <div className={css.stamp}>
          Positioning
          <br />
          Memory
        </div>
      </div>

      {/* one-liner */}
      <div className={css.section}>
        <div className={css.secHead}>
          <span className={css.secNum}>01</span>
          <span className={css.secTitle}>Your one-liner</span>
        </div>
        <div className={css.secHint}>The single sentence every page must be able to stand behind.</div>
        <input
          className={css.oneliner}
          value={oneLiner}
          onChange={(e) => setOneLiner(e.target.value)}
          placeholder="We help B2B SaaS operators ship research-grade personalization at volume."
          maxLength={200}
        />
        <div className={css.count}>{oneLiner.length}/200</div>
      </div>

      {/* proof points */}
      <div className={css.section}>
        <div className={css.secHead}>
          <span className={css.secNum}>02</span>
          <span className={css.secTitle}>Three proof points</span>
        </div>
        <div className={css.secHint}>
          Exactly three — one lens each is ideal. Tag how each proof earns trust: technical, roi, or gtm.
        </div>
        <div className={css.proof}>
          {proofs.map((p, i) => (
            <div className={css.proofRow} key={i}>
              <span className={css.proofIdx}>{i + 1}</span>
              <div className={css.tagSel}>
                <div className={css.tagBtns}>
                  {TAGS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`${css.tagBtn} ${p.tag === t ? `${css.on} ${css[t]}` : ""}`}
                      onClick={() => setProof(i, { tag: t })}
                      aria-pressed={p.tag === t}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <input
                className={css.proofInput}
                value={p.text}
                onChange={(e) => setProof(i, { text: e.target.value })}
                placeholder={`Proof point ${i + 1}`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* tone */}
      <div className={css.section}>
        <div className={css.secHead}>
          <span className={css.secNum}>03</span>
          <span className={css.secTitle}>Tone rules</span>
        </div>
        <div className={css.secHint}>How the agency should sound. One rule per entry.</div>
        <ListEditor items={tone} onChange={setTone} placeholder="e.g. Active voice, sentence case…" />
      </div>

      {/* forbidden */}
      <div className={css.section}>
        <div className={css.secHead}>
          <span className={css.secNum}>04</span>
          <span className={css.secTitle}>Forbidden claims</span>
        </div>
        <div className={css.secHint}>Never say these — the build gate hard-blocks any page that does.</div>
        <ListEditor
          items={forbidden}
          onChange={setForbidden}
          placeholder="e.g. #1 in the market, guaranteed ROI…"
          variant="forbid"
        />
      </div>

      {/* verticals */}
      <div className={css.section}>
        <div className={css.secHead}>
          <span className={css.secNum}>05</span>
          <span className={css.secTitle}>Target verticals</span>
        </div>
        <div className={css.secHint}>The industries you're briefing the agency to pursue.</div>
        <ListEditor items={verticals} onChange={setVerticals} placeholder="e.g. Fintech, Dev Tools…" />
      </div>

      {/* save */}
      <div className={css.saveBar}>
        <span className={`${css.saveMsg} ${!ready ? css.warn : ""}`}>
          {ready
            ? "Brief complete — ready to file."
            : "Add a one-liner and fill all three proof points to file the brief."}
        </span>
        <div className={css.saveActions}>
          <button className="btn btn-ghost" type="button" onClick={loadExample}>
            Load example
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!ready || saving}>
            {saving ? "Filing…" : "File the brief"}
          </button>
        </div>
      </div>
    </div>
  );
}
