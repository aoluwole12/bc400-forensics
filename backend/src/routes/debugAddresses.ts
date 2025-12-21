import type { Express, Request, Response } from "express";
import { confirmAddresses } from "../utils/validateAddresses";

export function registerDebugAddressesRoute(app: Express) {
  const handler = (_req: Request, res: Response) => {
    const checks = confirmAddresses([
      { label: "BC400_TOKEN_ADDRESS", address: process.env.BC400_TOKEN_ADDRESS || "" },
      { label: "BC400_PAIR_ADDRESS", address: process.env.BC400_PAIR_ADDRESS || "" },
      { label: "WBNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" },
      { label: "PANCAKESWAP_FACTORY", address: "0xca143ce32fe78f1f7019d7d551a6402fc5350c73" },
      { label: "DEAD", address: "0x000000000000000000000000000000000000dEaD" },
      { label: "ZERO", address: "0x0000000000000000000000000000000000000000" },
    ]);

    res.json({
      ok: checks.every((c) => c.ok),
      checks,
      updatedAt: new Date().toISOString(),
    });
  };

  app.get("/debug/addresses", handler);
  app.get("/api/debug/addresses", handler);
}
