// ----------------------
// /top-holders – from holder_balances
// ----------------------
app.get("/top-holders", async (req, res) => {
  const client = await pool.connect();
  try {
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 25, 1),
      200,
    );

    const result = await client.query<{
      address_id: number;
      address: string;
      balance_bc400: string;
      balance_raw: string;
      first_seen: string;
      last_seen: string;
      tx_count: number;
      last_block_number: string | null;
      last_block_time: string | null;
      last_tx_hash: string | null;
    }>(
      `
      SELECT
        hb.address_id,
        a.address,
        hb.balance_bc400,
        hb.balance_raw,
        hb.first_seen,
        hb.last_seen,
        hb.tx_count,
        hb.last_block_number,
        hb.last_block_time,
        hb.last_tx_hash
      FROM holder_balances hb
      JOIN addresses a
        ON a.id = hb.address_id
      WHERE hb.balance_bc400::numeric > 0
      ORDER BY hb.balance_bc400::numeric DESC
      LIMIT $1;
    `,
      [limit],
    );

    res.json({
      holders: result.rows.map((r, idx) => ({
        rank: idx + 1,
        addressId: r.address_id,
        address: r.address,
        balanceBc400: r.balance_bc400,
        balanceRaw: r.balance_raw,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
        txCount: r.tx_count,
        lastBlockNumber: r.last_block_number
          ? Number(r.last_block_number)
          : null,
        lastBlockTime: r.last_block_time,
        lastTxHash: r.last_tx_hash,
        // wallet_tags table doesn't exist yet, so return empty list
        tags: [] as string[],
      })),
    });
  } catch (err) {
    handleError(res, "top holders", err);
  } finally {
    client.release();
  }
});