export const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export const BC400_CONTRACT_ADDRESS =
  (import.meta.env.VITE_BC400_CONTRACT_ADDRESS || "").trim();

export const explorerTokenUrl = (contractAddress: string) => {
  const addr = (contractAddress || "").trim();
  if (!addr) return "https://bscscan.com/";
  return `https://bscscan.com/token/${addr}`;
};
