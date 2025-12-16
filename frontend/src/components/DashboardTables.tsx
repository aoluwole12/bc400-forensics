import React from "react";

// -----------------------------
// Demo/static data (unchanged)
// -----------------------------
const topHolders = [
  {
    rank: 1,
    address: "0x000000000000000000000000000000000000dead",
    balance: "4,296,216,637,054,626",
  },
  {
    rank: 2,
    address: "0x7033d68854706e7b91679e11377af1e0477735",
    balance: "2,187,460,123,466,789",
  },
];

const latestTransfers = [
  {
    block: "70,843,112",
    datetime: "12/07/2025, 06:18:08 PM",
    from: "0xaa02e8753ccd35eee44a77ccb1511538260ec8c5",
    to: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    amount: "1,000,000,000,000,000,000",
  },
];

const latestBuys = [
  {
    block: "70,843,112",
    datetime: "12/07/2025, 06:18:08 PM",
    from: "@xfrom_buy_demo",
    to: "@xto_buy_demo",
    amount: "1,000,000,000,000,000,000",
    remainingTo: "5,000,000,000,000,000,000",
  },
];

const latestSells = [
  {
    block: "70,843,112",
    datetime: "12/07/2025, 06:18:08 PM",
    from: "@xfrom_sell_demo",
    to: "@xto_sell_demo",
    amount: "2,000,000,000,000,000,000",
    remainingFrom: "0",
  },
];

// -----------------------------
// Formatting helpers (BC400 = 18 decimals)
// Display only (does not change data)
// -----------------------------
const BC400_DECIMALS = 18;

function toBigIntSafe(input: string): bigint {
  const s = String(input ?? "").trim().replace(/,/g, "");
  if (s === "" || s === "-") return 0n;

  const cleaned = s.startsWith("-")
    ? "-" + s.slice(1).replace(/[^\d]/g, "")
    : s.replace(/[^\d]/g, "");

  if (cleaned === "" || cleaned === "-") return 0n;

  try {
    return BigInt(cleaned);
  } catch {
    return 0n;
  }
}

/**
 * Raw detection for 18dp token ints:
 * - integer only
 * - length >= 19 digits (so shifting 18 makes sense)
 */
function looksRaw18(v: string): boolean {
  const s = String(v ?? "").trim().replace(/,/g, "");
  if (!/^-?\d+$/.test(s)) return false;
  return s.replace("-", "").length >= 19;
}

function addCommas(intStr: string): string {
  const neg = intStr.startsWith("-");
  const s = neg ? intStr.slice(1) : intStr;
  const out = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return neg ? `-${out}` : out;
}

/**
 * raw integer units -> "12,345.67" (BC400 18dp)
 */
function formatFromRaw18(raw: string, maxFrac = 6, minFrac = 2): string {
  const bi = toBigIntSafe(raw);
  const neg = bi < 0n;
  const abs = neg ? -bi : bi;

  const base = 10n ** BigInt(BC400_DECIMALS);
  const whole = abs / base;
  const frac = abs % base;

  const wholeStr = addCommas(whole.toString());

  const fracFull = frac.toString().padStart(BC400_DECIMALS, "0");
  let fracCut = fracFull.slice(0, Math.min(maxFrac, BC400_DECIMALS));

  // trim trailing zeros, keep at least minFrac
  fracCut = fracCut.replace(/0+$/, "");
  while (fracCut.length < minFrac) fracCut += "0";
  if (fracCut.length === 0) fracCut = "0".repeat(minFrac);

  const out = `${wholeStr}.${fracCut}`;
  return neg ? `-${out}` : out;
}

/**
 * decimal or integer string -> commas + controlled decimals
 * - shifts ONLY when looksRaw18() is true
 * - IMPORTANT: if it's a human integer and minFrac>0, append ".00"
 */
function formatHumanDecimal(input: string, maxFrac = 6, minFrac = 2): string {
  const s = String(input ?? "").trim().replace(/,/g, "");
  if (s === "" || s === "-") return "0";

  // raw token int (18dp)
  if (looksRaw18(s)) return formatFromRaw18(s, maxFrac, minFrac);

  // plain integer (human) -> commas + .00 if requested
  if (/^-?\d+$/.test(s)) {
    const whole = addCommas(s);
    if (minFrac > 0) return `${whole}.${"0".repeat(minFrac)}`;
    return whole;
  }

  // decimal (human)
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const neg = s.startsWith("-");
    const v = neg ? s.slice(1) : s;
    const [w = "0", f = ""] = v.split(".");
    const whole = addCommas((w || "0").replace(/^0+(?=\d)/, "") || "0");

    let frac = (f || "").slice(0, maxFrac);
    frac = frac.replace(/0+$/, "");

    while (frac.length < minFrac) frac += "0";
    if (minFrac > 0 && frac.length === 0) frac = "0".repeat(minFrac);

    return frac.length ? `${neg ? "-" : ""}${whole}.${frac}` : `${neg ? "-" : ""}${whole}`;
  }

  // fallback
  return input;
}

/**
 * BC400 amount/balance formatter:
 * - raw -> shift 18dp
 * - human -> commas + 2..6 decimals
 */
function fmtBC400(v: string | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return formatHumanDecimal(v, 6, 2);
}

/**
 * Integer formatter (blocks only)
 */
function fmtInt(v: string | null | undefined): string {
  if (!v) return "-";
  const s = String(v).trim().replace(/,/g, "");
  if (/^-?\d+$/.test(s)) return addCommas(s);
  return v;
}

function DashboardTables() {
  return (
    <div className="tables-layout">
      {/* TOP HOLDERS */}
      <section className="data-section">
        <div className="data-section-header">
          <h2 className="data-section-title">TOP HOLDERS</h2>
          <button className="data-section-link" type="button">
            view more
          </button>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th className="col-rank">#</th>
              <th>ADDRESS</th>
              <th className="col-amount">BALANCE BC400</th>
            </tr>
          </thead>
          <tbody>
            {topHolders.map((h) => (
              <tr key={h.rank}>
                <td className="col-rank">{h.rank}</td>
                <td className="mono">{h.address}</td>
                <td className="col-amount mono">{fmtBC400(h.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* LATEST TRANSFERS */}
      <section className="data-section">
        <div className="data-section-header">
          <h2 className="data-section-title">LATEST TRANSFERS</h2>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>BLOCK</th>
              <th>DATE / TIME</th>
              <th>FROM</th>
              <th>TO</th>
              <th className="col-amount">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {latestTransfers.map((t) => (
              <tr key={t.block + t.from}>
                <td className="mono">{fmtInt(t.block)}</td>
                <td>{t.datetime}</td>
                <td className="mono">{t.from}</td>
                <td className="mono">{t.to}</td>
                <td className="col-amount mono">{fmtBC400(t.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* LATEST BUYS */}
      <section className="data-section">
        <div className="data-section-header">
          <h2 className="data-section-title">LATEST BUYS</h2>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>BLOCK</th>
              <th>DATE / TIME</th>
              <th>FROM</th>
              <th>TO</th>
              <th className="col-amount">AMOUNT</th>
              <th className="col-amount">REMAINING (TO)</th>
            </tr>
          </thead>
          <tbody>
            {latestBuys.map((b) => (
              <tr key={b.block + b.from}>
                <td className="mono">{fmtInt(b.block)}</td>
                <td>{b.datetime}</td>
                <td className="mono">{b.from}</td>
                <td className="mono">{b.to}</td>
                <td className="col-amount mono">{fmtBC400(b.amount)}</td>
                <td className="col-amount mono">{fmtBC400(b.remainingTo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* LATEST SELLS */}
      <section className="data-section">
        <div className="data-section-header">
          <h2 className="data-section-title">LATEST SELLS</h2>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>BLOCK</th>
              <th>DATE / TIME</th>
              <th>FROM</th>
              <th>TO</th>
              <th className="col-amount">AMOUNT</th>
              <th className="col-amount">REMAINING (FROM)</th>
            </tr>
          </thead>
          <tbody>
            {latestSells.map((s) => (
              <tr key={s.block + s.from}>
                <td className="mono">{fmtInt(s.block)}</td>
                <td>{s.datetime}</td>
                <td className="mono">{s.from}</td>
                <td className="mono">{s.to}</td>
                <td className="col-amount mono">{fmtBC400(s.amount)}</td>
                <td className="col-amount mono">{fmtBC400(s.remainingFrom)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default DashboardTables;