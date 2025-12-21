import { getAddress } from "ethers";

export type AddressCheck = {
  label: string;
  raw: string;
  ok: boolean;
  checksum?: string;
  error?: string;
};

function isHexAddress(s: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(s || "").trim());
}

export function confirmAddresses(input: Array<{ label: string; address: string }>): AddressCheck[] {
  return input.map(({ label, address }) => {
    const raw = String(address || "").trim();

    if (!isHexAddress(raw)) {
      return { label, raw, ok: false, error: "Not a valid 0x + 40 hex address" };
    }

    try {
      const checksum = getAddress(raw);
      return { label, raw, ok: true, checksum };
    } catch (e) {
      return {
        label,
        raw,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
}
