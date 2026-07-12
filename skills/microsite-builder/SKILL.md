---
name: microsite-builder
description: >
  Generates the personalized microsite for one account from a research packet. Use whenever a
  pipeline task requires building, generating, or regenerating a microsite, GTM page, landing
  page, or outreach page for a target account. Takes the account-researcher JSON packet plus the
  operator's positioning memory; outputs a single self-contained HTML file with the tracking
  beacon embedded. Contains the mandatory storytelling spine and design language — always load
  this skill before writing any microsite HTML, never freestyle a page.
---

# Microsite builder

You build one page per invocation. Inputs: the research packet (JSON), the
operator's positioning (from memory: one-liner, proof points, tone rules,
forbidden claims), and the design system assignment. Output: ONE self-contained
HTML file, no external framework, loads in under 1 second.

## Step 1 — choose the angle (storytelling)

Pick exactly one archetype based on the strongest findings (`hook_strength`)
and the `likely_objection`:

| Archetype | Use when findings show… |
|-----------|------------------------|
| cost | funding pressure, efficiency hires, consolidation news |
| speed | aggressive roadmap, competitive launches, eng hiring spikes |
| risk | regulatory vertical, security posture, compliance signals |
| talent | hard-to-fill roles open long, team scaling pains |
| competition | a named rival moved recently |

Log the choice: `{"angle": "...", "because_findings": [indices], "objection_addressed": "..."}`.
This log is what the operator reviews and regenerates against — the angle IS
the editable surface of this product.

## Step 2 — the narrative spine (fixed order, five sections max)

1. **Their world** — hero states a thesis about THEIR business in the first
   line, built from the top finding. Their company name in text. Not about us.
2. **Their pressure** — 2–3 sourced findings woven into one tension. Every
   claim carries a visible citation link. Citations are the anti-spam proof.
3. **The bridge** — the operator's product enters ONLY here, framed as the
   specific answer to the pressure above. Use positioning memory verbatim for
   claims; never invent capabilities.
4. **One proof** — a single proof point from positioning memory, chosen to
   match the reader lens (technical proof for CTO, ROI proof for CFO).
5. **One CTA** — named for what happens: "See the 20-minute teardown for
   {Company}", never "Learn more". One CTA only.

Copy rules: active voice, sentence case, no filler adjectives, the page speaks
about them for the first two-thirds. Echo `their_phrase` from brand hints once,
naturally. Word budget: 250–400 words total. Dense pages read as brochures.

## Step 3 — design language (mandatory)

**Derive, don't decorate.** The page's identity comes from the TARGET's world
via `brand_hints`, mapped to one of four fixed design systems:

| System | Register | Display face | Body face | Character |
|--------|----------|--------------|-----------|-----------|
| ledger | precise/serious (finserv, legal) | Fraunces | Inter | disciplined grid, generous white, one hairline accent in their hue |
| terminal | technical (devtools, infra) | JetBrains Mono | Söhne-like grotesk (fallback: Inter) | mono display, code-block signature, dark-on-light NOT dark theme |
| clinic | calm/clinical (health, edtech) | Source Serif 4 | Source Sans 3 | soft radius, muted palette, spacious line-height |
| signal | bold (consumer-ish B2B, martech) | Space Grotesk | Inter | oversized display type, one saturated accent from their hue |

Load faces from Google Fonts with `display=swap`; subset to used weights (400/500 only).

**One signature element per page** — spend all boldness in exactly one place,
derived from the research: an inline diagram of THEIR stack, a small
interactive before/after of THEIR workflow, a live-feeling counter tied to
THEIR metric. Everything else stays quiet. No signature = QA fail.

**Banned looks (auto-fail):** warm-cream bg + high-contrast serif + terracotta
accent; near-black bg + acid green; hairline broadsheet with zero radius and
dense columns. These are AI tells. If your draft resembles one, redesign.

**Floor (non-negotiable):** responsive to 360px, visible keyboard focus,
`prefers-reduced-motion` respected, semantic headings, single HTML file,
no logo or trademark styling of the target — their name in text only, with a
"Prepared for {Company} by {Operator}" line in the footer and a contact link
for takedown requests.

## Step 4 — impressions beacon (hooks tracking)

Embed exactly this instrumentation before `</body>`, pointing at the fleet
state endpoint (Convex HTTP endpoint or the API server URL passed in config):

```html
<script>
(function(){var e="{BEACON_URL}",a="{ACCOUNT_ID}";
function s(t,d){try{navigator.sendBeacon(e,JSON.stringify({a:a,t:t,d:d||null,ts:Date.now()}))}catch(_){}}
s("view");var f=!1;addEventListener("scroll",function(){if(!f&&scrollY>document.body.scrollHeight*0.5){f=!0;s("scroll50")}},{passive:!0});
document.addEventListener("click",function(ev){var c=ev.target.closest("[data-cta]");if(c)s("cta")});
})();
</script>
```

Tag the CTA anchor with `data-cta`. Three events only — view, scroll50, cta.
Do not add fingerprinting, identity capture, or extra trackers; visits are
intent signal, not surveillance.

## Output contract

```json
{"html_path": "sites/{account_id}/index.html",
 "angle_log": {...},
 "design_system": "ledger|terminal|clinic|signal",
 "signature_element": "one-line description",
 "word_count": 0,
 "claims_cited": 0}
```
