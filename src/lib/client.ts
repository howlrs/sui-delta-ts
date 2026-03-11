import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import {
  BluefinProSdk,
  BluefinRequestSigner,
  makeSigner,
} from "@bluefin-exchange/pro-sdk";
import { CONFIG, validateConfig } from "./config.js";

export async function createBluefinClient(): Promise<BluefinProSdk> {
  validateConfig();

  const suiClient = new SuiClient({ url: CONFIG.suiRpcUrl });
  const keypair = Ed25519Keypair.fromSecretKey(CONFIG.suiPrivateKey);

  // Cast needed: the SDK re-exports @mysten/sui types via @firefly-exchange/library-sui
  // which resolves to CJS types, while our ESM project resolves to ESM types.
  // The underlying classes are identical — only the TS declaration paths differ.
  const signer = new BluefinRequestSigner(
    makeSigner(keypair as any, false),
  );
  const client = new BluefinProSdk(
    signer,
    CONFIG.bluefinNetwork,
    suiClient as any,
  );

  await client.initialize();
  return client;
}
