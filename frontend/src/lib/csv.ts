// Client-side CSV / paste parsing, validation, and dedupe for the Intake screen.
// Required columns: company, domain, contact_title, vertical.
// Optional: contact_name, notes. Dedupe key: domain + contact_title.

export interface IntakeRow {
  company: string;
  domain: string;
  contact_title: string;
  vertical: string;
  contact_name?: string;
  notes?: string;
}

export interface ParsedRow {
  index: number; // 1-based data-row number (as pasted)
  row: IntakeRow;
  errors: string[];
  duplicate: boolean; // duplicate of an earlier kept row (by domain+title)
}

export interface ParseResult {
  rows: ParsedRow[];
  headerWarnings: string[];
  validCount: number; // no errors AND not a duplicate — these get sent
  errorCount: number;
  duplicateCount: number;
}

const REQUIRED: (keyof IntakeRow)[] = [
  "company",
  "domain",
  "contact_title",
  "vertical",
];

// Header synonym map -> canonical field.
const HEADER_SYNONYMS: Record<string, keyof IntakeRow> = {
  company: "company",
  company_name: "company",
  account: "company",
  organization: "company",
  org: "company",
  domain: "domain",
  website: "domain",
  site: "domain",
  url: "domain",
  web: "domain",
  contact_title: "contact_title",
  title: "contact_title",
  role: "contact_title",
  job_title: "contact_title",
  persona: "contact_title",
  vertical: "vertical",
  industry: "vertical",
  segment: "vertical",
  sector: "vertical",
  contact_name: "contact_name",
  contact: "contact_name",
  full_name: "contact_name",
  person: "contact_name",
  notes: "notes",
  note: "notes",
  comment: "notes",
  comments: "notes",
};

const POSITIONAL: (keyof IntakeRow)[] = [
  "company",
  "domain",
  "contact_title",
  "vertical",
  "contact_name",
  "notes",
];

/** RFC-4180-ish record splitter: handles quoted fields, escaped quotes, CRLF. */
function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += c;
    }
  }
  record.push(field);
  records.push(record);

  // Drop trailing fully-empty records.
  return records.filter(
    (r) => !(r.length === 1 && r[0].trim() === "") && r.some((f) => f.trim() !== "")
  );
}

function normKey(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function cleanDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\s+/g, "");
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function parseIntake(text: string): ParseResult {
  const headerWarnings: string[] = [];
  const records = splitRecords(text);

  if (records.length === 0) {
    return {
      rows: [],
      headerWarnings: ["No rows found."],
      validCount: 0,
      errorCount: 0,
      duplicateCount: 0,
    };
  }

  // Decide whether row 0 is a header: it is if >=2 cells map to known fields.
  const first = records[0];
  const mappedFromHeader = first
    .map((c) => HEADER_SYNONYMS[normKey(c)])
    .filter(Boolean);
  const hasHeader = new Set(mappedFromHeader).size >= 2;

  let columnMap: (keyof IntakeRow | null)[];
  let dataRecords: string[][];

  if (hasHeader) {
    columnMap = first.map((c) => HEADER_SYNONYMS[normKey(c)] ?? null);
    dataRecords = records.slice(1);
    const seen = new Set(columnMap.filter(Boolean) as string[]);
    const missing = REQUIRED.filter((r) => !seen.has(r));
    if (missing.length) {
      headerWarnings.push(
        `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`
      );
    }
  } else {
    columnMap = POSITIONAL.slice(0, Math.max(4, first.length));
    dataRecords = records;
    headerWarnings.push(
      "No header row detected — reading columns positionally: company, domain, contact_title, vertical, contact_name, notes."
    );
  }

  const seenKeys = new Set<string>();
  const rows: ParsedRow[] = [];

  dataRecords.forEach((rec, i) => {
    const obj: Partial<IntakeRow> = {};
    columnMap.forEach((field, ci) => {
      if (!field) return;
      const val = (rec[ci] ?? "").trim();
      if (val) obj[field] = val;
    });

    if (obj.domain) obj.domain = cleanDomain(obj.domain);

    const row: IntakeRow = {
      company: obj.company ?? "",
      domain: obj.domain ?? "",
      contact_title: obj.contact_title ?? "",
      vertical: obj.vertical ?? "",
      ...(obj.contact_name ? { contact_name: obj.contact_name } : {}),
      ...(obj.notes ? { notes: obj.notes } : {}),
    };

    const errors: string[] = [];
    for (const r of REQUIRED) {
      if (!row[r]) errors.push(`missing ${r}`);
    }
    if (row.domain && !DOMAIN_RE.test(row.domain)) {
      errors.push(`invalid domain "${row.domain}"`);
    }

    let duplicate = false;
    if (errors.length === 0) {
      const key = `${row.domain}||${row.contact_title.toLowerCase()}`;
      if (seenKeys.has(key)) {
        duplicate = true;
      } else {
        seenKeys.add(key);
      }
    }

    rows.push({ index: i + 1, row, errors, duplicate });
  });

  const errorCount = rows.filter((r) => r.errors.length > 0).length;
  const duplicateCount = rows.filter((r) => r.duplicate).length;
  const validCount = rows.filter((r) => r.errors.length === 0 && !r.duplicate).length;

  return { rows, headerWarnings, validCount, errorCount, duplicateCount };
}

/** The clean payload (deduped, error-free rows) for the run-factory webhook. */
export function toWebhookRows(result: ParseResult): IntakeRow[] {
  return result.rows
    .filter((r) => r.errors.length === 0 && !r.duplicate)
    .map((r) => r.row);
}

export const SAMPLE_CSV = `company,domain,contact_title,vertical,contact_name,notes
Northwind Robotics,northwind.io,VP Engineering,Industrial Automation,Dana Osei,Scaling fleet ops team 3x this year
Ledgerly,ledgerly.com,CFO,Fintech,,Series B announced last month
Cadence Health,cadencehealth.co,Head of Data,Digital Health,Sam Ruiz,HIPAA-sensitive; careful on claims`;
