import type { Express, Request, Response } from "express";
import { confirmAddresses } from "../utils/validateAddresses";

export function registerDebugAddressesRoute(app: Express) {
  const handler = (_req: Request, res: Response) => {
    const checks = confirmAddresses([
      // Env-driven
      { label: "BC400_TOKEN_ADDRESS", address: process.env.BC400_TOKEN_ADDRESS || "" },
      { label: "BC400_PAIR_ADDRESS", address: process.env.BC400_PAIR_ADDRESS || "" },
      { label: "BC400_TREASURY_WALLET", address: process.env.BC400_TREASURY_WALLET || "" },
      { label: "BC400_DEV_BURN_WALLET", address: process.env.BC400_DEV_BURN_WALLET || "0x000000000000000000000000000000000000dead" },

      // Chain constants
      { label: "WBNB", address: "0xbb4CdB9CBd36B01bd1cBaEBF2De08d9173bc095c" },
      { label: "PANCAKESWAP_V2_FACTORY", address: "0xca143ce32fe78f1f7019d7d551a6402fc5350c73" },

      // Sentinels
      { label: "ZERO", address: "0x0000000000000000000000000000000000000000" },
      { label: "DEAD_GENERIC", address: "0x000000000000000000000000000000000000dead" },
    ]);

    return res.json({
      ok: checks.every((c) => c.ok),
      checks,
      updatedAt: new Date().toISOString(),
    });
  };

  app.get("/debug/addresses", handler);
  app.get("/api/debug/addresses", handler);
}