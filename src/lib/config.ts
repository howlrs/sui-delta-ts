import "dotenv/config";

export const CONFIG = {
  suiPrivateKey: process.env.SUI_PRIVATE_KEY ?? "",
  suiRpcUrl: process.env.SUI_RPC_URL ?? "https://fullnode.mainnet.sui.io:443",
  bluefinNetwork: (process.env.BLUEFIN_NETWORK ?? "mainnet") as
    | "mainnet"
    | "testnet",
  symbol: process.env.SYMBOL ?? "SUI-PERP",
} as const;

export function validateConfig(): void {
  if (!CONFIG.suiPrivateKey) {
    throw new Error("SUI_PRIVATE_KEY is required in .env");
  }
}
