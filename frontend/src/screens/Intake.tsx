import { useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import css from "./Intake.module.css";
import { parseIntake, toWebhookRows, SAMPLE_CSV } from "../lib/csv";
import { runFactory } from "../lib/factoryApi";
import { usd } from "../lib/format";
import { Modal, ModalActions } from "../components/Modal";
import { useToast } from "../components/Toast";

const COST_CONFIRM_THRESHOLD = 25;
const CEILING_PER_ACCOUNT = 2;

export function Intake() {
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const navigate = useNavigate();

  const result = useMemo(() => (text.trim() ? parseIntake(text) : null), [text]);
  const validRows = useMemo(() => (result ? toWebhookRows(result) : []), [result]);
  const estMaxCost = validRows.length * CEILING_PER_ACCOUNT;

  function loadFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  }

  async function doSend() {
    setConfirmOpen(false);
    setSending(true);
    const res = await runFactory(validRows);
    setSending(false);
    if (res.ok) {
      toast(
        "ok",
        <>
          <strong>Factory started.</strong> {validRows.length} account
          {validRows.length === 1 ? "" : "s"} dispatched to Hermes. Watch the fleet board.
        </>
      );
      navigate("/");
    } else {
      toast(
        "err",
        <>
          <strong>Run failed.</strong> {res.error}
          {res.detail ? ` — ${res.detail}` : ""}
        </>
      );
    }
  }

  function onRun() {
    if (validRows.length === 0) return;
    if (validRows.length > COST_CONFIRM_THRESHOLD) {
      setConfirmOpen(true);
    } else {
      void doSend();
    }
  }

  return (
    <div className={css.wrap}>
      <div className={css.head}>
        <h1>Intake</h1>
        <p>
          Paste or upload your ICP account list. We validate, dedupe, and hand a clean batch to
          the agency. Required columns: company, domain, contact_title, vertical.
        </p>
      </div>

      <div className={css.layout}>
        {/* input */}
        <section className={`panel ${css.inputPanel}`}>
          <div
            className={`${css.dropzone} ${dragging ? css.drag : ""}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
            }}
            aria-label="Upload a CSV file"
          >
            <div className={css.dzicon}>⇪</div>
            <div>
              <b>Drop a CSV</b> or click to browse
            </div>
            <p>.csv · headers auto-detected</p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) loadFile(f);
              }}
            />
          </div>

          <div className={css.divider}>OR PASTE</div>

          <div>
            <div className={css.labelRow}>
              <label htmlFor="paste" className="eyebrow">
                CSV / TSV rows
              </label>
              <button className={css.linkBtn} onClick={() => setText(SAMPLE_CSV)} type="button">
                load sample
              </button>
            </div>
            <textarea
              id="paste"
              className={css.paste}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"company,domain,contact_title,vertical,contact_name,notes\nNorthwind Robotics,northwind.io,VP Engineering,Industrial Automation,,scaling ops"}
              spellCheck={false}
            />
          </div>

          <p className={css.hint}>
            Dedupe key is <code>domain + contact_title</code> — the same person at the same company
            is only built once. Rows missing a required field or with an invalid domain are held
            back automatically.
          </p>
          {text && (
            <button className="btn btn-ghost" type="button" onClick={() => setText("")}>
              Clear
            </button>
          )}
        </section>

        {/* results */}
        <section className={css.results}>
          {!result ? (
            <div className={css.emptyRes}>
              Paste or upload to preview validation. Nothing is sent until you press{" "}
              <b>Run factory</b>.
            </div>
          ) : (
            <>
              <div className={css.summary}>
                <div className={`${css.stat} ${css.ok}`}>
                  <b>{result.validCount}</b>
                  <span>ready</span>
                </div>
                <div className={`${css.stat} ${css.dup}`}>
                  <b>{result.duplicateCount}</b>
                  <span>duplicates</span>
                </div>
                <div className={`${css.stat} ${css.err}`}>
                  <b>{result.errorCount}</b>
                  <span>errors</span>
                </div>
                <div className={css.summarySpacer} />
                <div style={{ textAlign: "right" }}>
                  <button
                    className="btn btn-primary"
                    onClick={onRun}
                    disabled={result.validCount === 0 || sending}
                  >
                    {sending ? "Dispatching…" : `Run factory · ${result.validCount}`}
                  </button>
                  <div className={css.costNote}>
                    est. ≤ {usd(estMaxCost)} ({usd(CEILING_PER_ACCOUNT)}/account ceiling)
                  </div>
                </div>
              </div>

              {result.headerWarnings.length > 0 && (
                <div className={css.warnings}>
                  {result.headerWarnings.map((w, i) => (
                    <span key={i}>⚠ {w}</span>
                  ))}
                </div>
              )}

              <div className={css.tableWrap}>
                <table className={css.tbl}>
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>#</th>
                      <th>Company</th>
                      <th>Domain</th>
                      <th>Title</th>
                      <th>Vertical</th>
                      <th style={{ width: 160 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => {
                      const hasErr = r.errors.length > 0;
                      return (
                        <tr
                          key={r.index}
                          className={hasErr ? css.rowErr : r.duplicate ? css.rowDup : ""}
                        >
                          <td className={css.rowNum}>{r.index}</td>
                          <td>{r.row.company || <span className={css.cellMono}>—</span>}</td>
                          <td className={css.cellMono}>{r.row.domain || "—"}</td>
                          <td>{r.row.contact_title || <span className={css.cellMono}>—</span>}</td>
                          <td>{r.row.vertical || <span className={css.cellMono}>—</span>}</td>
                          <td>
                            {hasErr ? (
                              <>
                                <span className={`${css.rowState} ${css.sErr}`}>✕ error</span>
                                <div className={css.errMsgs}>{r.errors.join(", ")}</div>
                              </>
                            ) : r.duplicate ? (
                              <span className={`${css.rowState} ${css.sDup}`}>⊘ duplicate</span>
                            ) : (
                              <span className={`${css.rowState} ${css.sOk}`}>✓ ready</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm a large run">
        <p style={{ color: "var(--fg-dim)", fontSize: 14, lineHeight: 1.6 }}>
          You're about to dispatch <strong style={{ color: "var(--fg)" }}>{validRows.length} accounts</strong>{" "}
          to the factory. At the <span className="mono">{usd(CEILING_PER_ACCOUNT)}</span>/account ceiling
          that's up to{" "}
          <strong style={{ color: "var(--amber-bright)" }} className="mono">
            {usd(estMaxCost)}
          </strong>{" "}
          of research + build spend. Each account still passes every QA gate.
        </p>
        <ModalActions>
          <button className="btn" onClick={() => setConfirmOpen(false)}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={doSend}>
            Run {validRows.length} accounts
          </button>
        </ModalActions>
      </Modal>
    </div>
  );
}
