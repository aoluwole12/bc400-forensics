import React from 'react';

const topHolders = [
  {
    rank: 1,
    address: '0x000000000000000000000000000000000000dead',
    balance: '4,296,216,637,054,626',
  },
  {
    rank: 2,
    address: '0x7033d68854706e7b91679e11377af1e0477735',
    balance: '2,187,460,123,466,789',
  },
];

const latestTransfers = [
  {
    block: '70,843,112',
    datetime: '12/07/2025, 06:18:08 PM',
    from: '0xaa02e8753ccd35eee44a77ccb1511538260ec8c5',
    to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    amount: '1,000,000,000,000,000,000',
  },
];

const latestBuys = [
  {
    block: '70,843,112',
    datetime: '12/07/2025, 06:18:08 PM',
    from: '@xfrom_buy_demo',
    to: '@xto_buy_demo',
    amount: '1,000,000,000,000,000,000',
    remainingTo: '5,000,000,000,000,000,000',
  },
];

const latestSells = [
  {
    block: '70,843,112',
    datetime: '12/07/2025, 06:18:08 PM',
    from: '@xfrom_sell_demo',
    to: '@xto_sell_demo',
    amount: '2,000,000,000,000,000,000',
    remainingFrom: '0',
  },
];

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
                <td className="col-amount mono">{h.balance}</td>
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
                <td className="mono">{t.block}</td>
                <td>{t.datetime}</td>
                <td className="mono">{t.from}</td>
                <td className="mono">{t.to}</td>
                <td className="col-amount mono">{t.amount}</td>
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
                <td className="mono">{b.block}</td>
                <td>{b.datetime}</td>
                <td className="mono">{b.from}</td>
                <td className="mono">{b.to}</td>
                <td className="col-amount mono">{b.amount}</td>
                <td className="col-amount mono">{b.remainingTo}</td>
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
                <td className="mono">{s.block}</td>
                <td>{s.datetime}</td>
                <td className="mono">{s.from}</td>
                <td className="mono">{s.to}</td>
                <td className="col-amount mono">{s.amount}</td>
                <td className="col-amount mono">{s.remainingFrom}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default DashboardTables;