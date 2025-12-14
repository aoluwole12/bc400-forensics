import express from "express";
import cors from "cors";
import { Pool } from "pg";

import { registerSummaryRoute } from "./summary";
import { registerTopHoldersRoute } from "./topHolders";
import { registerTransfersRoute } from "./transfers";
import { registerHealthRoute } from "./health";
import { registerDailyReportRoute } from "./dailyReport";

const app = express();
const port = Number(process.env.PORT) || 4000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : undefined,
});

app.use(cors());
app.use(express.json());

registerSummaryRoute(app, pool);
registerTopHoldersRoute(app, pool);
registerTransfersRoute(app, pool);
registerHealthRoute(app, pool);
registerDailyReportRoute(app, pool);

app.get("/", (_req, res) => {
  res.send("BC400 Forensics backend is running");
});

app.listen(port, () => {
  console.log(`BC400 backend listening on port ${port}`);
});
