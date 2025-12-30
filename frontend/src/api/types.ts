export type DailyAudit = {
  generatedAt?: string; // ISO
  window?: {
    label?: string;
    start?: string;
    end?: string;
  };
  chain?: {
    lastIndexedBlock?: number | string | null;
    lastIndexedTime?: string | null;
  };
  transfers?: {
    txs24h?: number | string;
    txs6h?: number | string;
    txs1h?: number | string;
    activeWallets24h?: number | string;
    recent?: Array<{
      blockNumber: number | string;
      blockTime: string | null;
      txHash: string;
      logIndex: number;
      from: string | null;
      to: string | null;
      rawAmount: string;
    }>;
  };
  supply?: {
    snapshotTime?: string | null;
    totalSupplyRaw?: string | null;
    burnedRaw?: string | null;
    lpRaw?: string | null;
    lockedRaw?: string | null;
    circulatingRaw?: string | null;
    priceUsd?: string | number | null;
    marketcapUsd?: string | number | null;
    marketCapUsd?: string | number | null; // tolerate either key
    metadata?: any;
    flags?: {
      missing?: boolean;
      allZero?: boolean;
      inconsistent?: boolean;
    };
  };
  holders?: {
    top10?: {
      sumRaw?: string | number;
      sumBc400?: string | number;
    };
  };
  concentration?: {
    fromTable?: {
      ts?: string | null;
      top10PctTotal?: number | string | null;
      top10ValueTotalRaw?: string | null;
      top10PctCirculating?: number | string | null;
      top10ValueCirculatingRaw?: string | null;
      effectiveConcentrationPct?: number | string | null;
      riskScore?: number | string | null;
      riskLevel?: string | null;
      explanation?: string | null;
      components?: any;
    };
    derived?: {
      top10PctOfCirculating?: number | string | null;
    };
  };
  risk?: {
    latest?: {
      day?: string | null;
      score?: number | string | null;
      band?: string | null;
      reasons?: any;
      createdAt?: string | null;
    };
  };
};

export type DexTotals = {
  pairAddress: string;
  pairAddressId: number | null;
  definitions?: {
    buy?: string;
    sell?: string;
    excludedAddresses?: string[];
    excludedAddressIds?: number[];
  };
  totalBuys: number;
  totalSells: number;
  totalBoughtRaw: string;
  totalSoldRaw: string;
  note?: string;
};
