// src/clients/bscClient.ts
import { createPublicClient, http, webSocket } from 'viem';
import { bsc } from 'viem/chains';

const httpUrl = process.env.BSC_HTTP_URL!;
const wsUrl = process.env.BSC_WS_URL!;

if (!httpUrl) {
  throw new Error('BSC_HTTP_URL is not set in .env');
}

export const bscClient = createPublicClient({
  chain: bsc,
  transport: http(httpUrl),
});

export const bscWsClient = createPublicClient({
  chain: bsc,
  transport: webSocket(wsUrl),
});