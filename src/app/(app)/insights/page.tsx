import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { requirePage } from "@/server/auth/current";

export const metadata: Metadata = { title: "Industry context" };

const SOURCES = {
  rbiAr: { label: "RBI Annual Report 2024-25, via IANS (30 May 2025)", url: "https://ianslive.in/upi-share-surges-to-837-pc-in-digital-transactions-for-fy25--20250530153004" },
  rbiPsr: { label: "RBI Payment System Report, June 2025, via The Tribune", url: "https://www.tribuneindia.com/news/business/digital-payments-made-up-99-7-transactions-in-volume-in-2024-rbi" },
  npciFy26: { label: "NPCI data, via Angel One (FY26 to February)", url: "https://www.angelone.in/news/market-updates/upi-records-218-6-billion-transactions-valued-at-284-7-lakh-crore-in-fy26" },
  npciJul26: { label: "NPCI data, via StartupTalky (July 2026)", url: "https://startuptalky.com/india-upi-transactions-july-2026/" },
  outage: { label: "NPCI circular UPI-OC-215 (FY 2025-26), via MediaNama", url: "https://www.medianama.com/2025/04/223-npci-new-guidelines-upi-outage/" },
  declines: { label: "NPCI decline data (July 2022), via Inc42", url: "https://inc42.com/buzz/ncpi-working-on-real-time-fix-for-upi-transaction-failures" },
  tat: { label: "RBI circular RBI/2019-20/67, Harmonisation of TAT and customer compensation for failed transactions (20 Sep 2019)", url: "https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=11693" },
  neft: { label: "State Bank of India, RTGS/NEFT FAQ (RBI rules for credit and return)", url: "https://sbi.bank.in/en/web/faq-s/faq-rtgs-neft" },
  fraud: { label: "RBI Annual Report 2024-25 fraud data, via Deccan Chronicle (29 May 2025)", url: "https://www.deccanchronicle.com/amp/nation/bank-fraud-amount-triples-to-36014-cr-in-fy25-despite-fewer-cases-rbi-1882116" },
  ombudsman: { label: "RBI Annual Report of the Ombudsman Scheme 2024-25, via Business Standard (1 Dec 2025)", url: "https://www.business-standard.com/amp/finance/news/rbi-ombudsman-complaints-fy25-rise-loans-credit-cards-125120101346_1.html" },
  udir: { label: "Razorpay, “All you need to know about NPCI-led UDIR” (Feb 2024)", url: "https://razorpay.com/blog/all-you-need-to-know-about-npci-led-udir/" },
  localisation: { label: "RBI FAQ, Storage of Payment System Data (circular of 6 Apr 2018)", url: "https://rbi.org.in/scripts/FS_FAQs.aspx?Id=130" },
  repo: { label: "RBI MPC decision of 7 Oct 2026, via GKToday", url: "https://www.gktoday.in/rbi-hikes-repo-rate-by-25-basis-points-to-5-50/" },
} as const;

type SourceKey = keyof typeof SOURCES;
const ORDER = Object.keys(SOURCES) as SourceKey[];

function Cite({ s }: { s: SourceKey }) {
  const n = ORDER.indexOf(s) + 1;
  return (
    <sup>
      <a href={`#src-${n}`} className="text-accent hover:underline" aria-label={`Source ${n}`}>
        [{n}]
      </a>
    </sup>
  );
}

function Fact({ value, label, cite }: { value: string; label: string; cite: SourceKey }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-1 text-xl font-semibold">
        {value}
        <Cite s={cite} />
      </dd>
    </div>
  );
}

const CHALLENGES: { issue: string; evidence: React.ReactNode; response: string }[] = [
  {
    issue: "Transaction failures caused by network or server problems",
    evidence: (
      <>
        NPCI attributed the March–April 2025 UPI outages to banks flooding the switch with Check Transaction Status calls <Cite s="outage" />. Technical declines have historically varied widely by bank (5.06% at one large bank vs 0.08% at another in NPCI&apos;s July 2022 data) <Cite s="declines" />.
      </>
    ),
    response: "The simulator injects technical declines, timeouts after debit and deemed responses. The engine marks unresolved states as Delayed instead of failing them, and its UPI playbook follows NPCI's status-check limits (first check after 90 s, at most 3 in 2 hours) rather than hammering the switch.",
  },
  {
    issue: "Temporary inconsistency between payment and merchant systems",
    evidence: (
      <>
        RBI sets a T+5 auto-reversal for UPI and card payments where the account is debited but the merchant gets no confirmation, with ₹100/day compensation beyond that <Cite s="tat" />.
      </>
    ),
    response: "“Successful, merchant not updated” exceptions carry the RBI deadline, show compensation accruing after it, and recommend a status push before a refund.",
  },
  {
    issue: "Duplicate transaction requests",
    evidence: <>App retries after a slow response are a known cause of double debits; NPCI now restricts repeated status calls for the same transaction <Cite s="outage" />.</>,
    response: "Exact duplicates (same reference twice in one participant's file) and suspected duplicate requests (same customer, merchant and amount within a configurable window) are both detected; the second needs a human because it can be a genuine repeat purchase.",
  },
  {
    issue: "Fraudulent or suspicious transactions",
    evidence: (
      <>
        RBI reported 13,516 card and internet fraud cases worth ₹1,457 crore in FY25, down from 29,082 cases but up from ₹520 crore in value <Cite s="fraud" />.
      </>
    ),
    response: "PayTrace is a reconciliation tool, not a fraud engine. It surfaces reconciliation signals that often accompany abuse (merchant marked paid on a failed payment, refunds exceeding the original, double payouts after reversal) as manual-review exceptions. Real-time fraud scoring is out of scope.",
  },
  {
    issue: "Delayed refunds",
    evidence: <>NPCI&apos;s UDIR moved UPI refunds from a 3–5 day file process to an API, and auto-converts unanswered merchant complaints into chargebacks <Cite s="udir" />.</>,
    response: "Refunds are matched between merchant and customer bank: refunds not credited, refunds missing in merchant books, pending refunds and refunds above the original amount all raise a Refund mismatch.",
  },
  {
    issue: "Increasing transaction volumes",
    evidence: (
      <>
        UPI processed 185.8 billion transactions in FY25 (83.7% of digital payment volume) <Cite s="rbiAr" /> and hit 23.66 billion in July 2026 alone <Cite s="npciJul26" />.
      </>
    ),
    response: "Matching is hash-based (linear in the number of records) and runs in a background worker; records are bulk-loaded with PostgreSQL COPY and results are written inside one transaction. The test suite reconciles 100,000 transactions (about 4.8 lakh participant records); see the README for measured timings.",
  },
  {
    issue: "Difficulty identifying the exact point of failure",
    evidence: <>Unblocking funds from failed UPI transactions used to take over 24 hours because banks waited for counterparty statements <Cite s="declines" />.</>,
    response: "Every exception names the first participant in the payment path whose record disagrees, shows each participant's view side by side, and for simulated data replays the switch timeline hop by hop.",
  },
  {
    issue: "Need for faster automated reconciliation",
    evidence: (
      <>
        RBI Ombudsman complaints rose 13.55% to about 13.3 lakh in FY25; digital, mobile and electronic banking made up 16.86% of them <Cite s="ombudsman" />.
      </>
    ),
    response: "Five participant files are compared in one run, each break is categorised with a suspected cause and next action, auto-actionable cases are separated from those needing investigation, and the TAT clock is visible from the first minute.",
  },
];

export default async function InsightsPage() {
  await requirePage("dashboard:view");
  return (
    <>
      <PageHeader
        title="Industry context"
        description="Why reconciliation and failure detection matter for Indian digital payments, and the rules PayTrace encodes. Figures are from RBI and NPCI publications, cited inline; secondary reports are named as such."
      />
      <section aria-labelledby="scale" className="mb-6">
        <h2 id="scale" className="mb-3 text-lg font-semibold">
          Scale
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact value="185.8 bn" label="UPI transactions in FY25 (+41%)" cite="rbiAr" />
          <Fact value="83.7%" label="UPI share of digital payment volume, FY25" cite="rbiAr" />
          <Fact value="99.7%" label="Digital share of payment volume, CY2024" cite="rbiPsr" />
          <Fact value="₹284.7 lakh cr" label="UPI value, FY26 (Apr 2025–Feb 2026)" cite="npciFy26" />
        </dl>
      </section>

      <Card title="Eight challenges, the evidence, and what PayTrace does" className="mb-6" id="challenges">
        <div className="-mx-4 -mb-4 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col" className="w-1/5">
                  Challenge
                </th>
                <th scope="col" className="w-2/5">
                  Evidence
                </th>
                <th scope="col" className="w-2/5">
                  How PayTrace responds
                </th>
              </tr>
            </thead>
            <tbody>
              {CHALLENGES.map((c) => (
                <tr key={c.issue}>
                  <th scope="row" className="!static !bg-transparent align-top text-sm font-semibold text-ink">
                    {c.issue}
                  </th>
                  <td className="text-ink-2">{c.evidence}</td>
                  <td className="text-ink-2">{c.response}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title="Customer-protection deadlines encoded in PayTrace" id="tat">
          <ul className="space-y-2 text-sm text-ink-2">
            <li>
              <strong className="text-ink">UPI transfer, beneficiary not credited:</strong> reverse by T+1; ₹100/day beyond <Cite s="tat" />
            </li>
            <li>
              <strong className="text-ink">UPI merchant payment, no confirmation:</strong> auto-reverse within T+5; ₹100/day beyond <Cite s="tat" />
            </li>
            <li>
              <strong className="text-ink">Card at POS, no charge slip:</strong> auto-reverse within T+5; ₹100/day beyond <Cite s="tat" />
            </li>
            <li>
              <strong className="text-ink">Card not present (e-commerce):</strong> the RBI table leaves this row blank; PayTrace applies the POS rule (T+5) as an internal standard <Cite s="tat" />
            </li>
            <li>
              <strong className="text-ink">NEFT:</strong> credit within 2 hours of the settlement batch or return within B+2 hours <Cite s="neft" />; penal interest at repo + 2% (repo 5.50% since 7 Oct 2026, configurable) <Cite s="repo" />
            </li>
            <li>
              <strong className="text-ink">RTGS:</strong> credit within 30 minutes; return within 1 hour of receipt <Cite s="neft" />
            </li>
          </ul>
          <p className="mt-3 text-xs text-ink-3">T is the calendar date of the transaction. Compensation must be paid without the customer having to claim it <Cite s="tat" />.</p>
        </Card>
        <Card title="Deployment implication: data localisation" id="localisation">
          <p className="text-sm text-ink-2">
            RBI requires the entire payment data of authorised payment system operators, including end-to-end transaction details, to be stored only in systems located in India <Cite s="localisation" />. A production PayTrace deployment that handles real payment data must therefore run its database, backups and logs in an Indian region (for example AWS ap-south-1 Mumbai or GCP asia-south1). The README covers this.
          </p>
          <p className="mt-3 text-sm text-ink-2">
            PayTrace stores no card numbers: uploads with values that look like full card numbers (Luhn-valid, 13–19 digits) in identifier columns are rejected.
          </p>
        </Card>
      </div>

      <Card title="Sources" id="sources">
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {ORDER.map((k, i) => (
            <li key={k} id={`src-${i + 1}`}>
              <a href={SOURCES[k].url} className="text-accent hover:underline" rel="noopener noreferrer" target="_blank">
                {SOURCES[k].label}
              </a>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-ink-3">Checked 29 October 2026. Where a figure comes from a news report of an RBI or NPCI publication, the report is named. Decline-rate figures are from 2022 and illustrate variation between banks, not current rates.</p>
      </Card>
    </>
  );
}
