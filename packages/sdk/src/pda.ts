import { INDEX_VAULT_PROGRAM_ID, MOCK_MARKET_PROGRAM_ID } from "@repo/config";
import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
} from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";

export const INDEX_VAULT = INDEX_VAULT_PROGRAM_ID as Address;
export const MOCK_MARKET = MOCK_MARKET_PROGRAM_ID as Address;
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;
export const SYSTEM_PROGRAM = "11111111111111111111111111111111" as Address;
export const INSTRUCTIONS_SYSVAR = "Sysvar1nstructions1111111111111111111111111" as Address;
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111" as Address;

const utf8 = getUtf8Encoder();
const addr = getAddressEncoder();
const u64 = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};

async function pda(programAddress: Address, seeds: Uint8Array[]): Promise<Address> {
  const [a] = await getProgramDerivedAddress({ programAddress, seeds });
  return a;
}

export const marketPda = () => pda(MOCK_MARKET, [utf8.encode("market") as Uint8Array]);
export const mockMintPda = (symbol: string) =>
  pda(MOCK_MARKET, [utf8.encode("mint") as Uint8Array, utf8.encode(symbol) as Uint8Array]);
export const feedPda = (mint: Address, marketProgram: Address = MOCK_MARKET) =>
  pda(marketProgram, [utf8.encode("feed") as Uint8Array, addr.encode(mint) as Uint8Array]);
export const ipoPda = (oldMint: Address) =>
  pda(MOCK_MARKET, [utf8.encode("ipo") as Uint8Array, addr.encode(oldMint) as Uint8Array]);

export const configPda = () => pda(INDEX_VAULT, [utf8.encode("config") as Uint8Array]);
export const indexPda = (creator: Address, indexId: bigint) =>
  pda(INDEX_VAULT, [
    utf8.encode("index") as Uint8Array,
    addr.encode(creator) as Uint8Array,
    u64(indexId),
  ]);
export const shareMintPda = (index: Address) =>
  pda(INDEX_VAULT, [utf8.encode("share") as Uint8Array, addr.encode(index) as Uint8Array]);

export async function ata(
  owner: Address,
  mint: Address,
  tokenProgram: Address = TOKEN_PROGRAM,
): Promise<Address> {
  const [a] = await findAssociatedTokenPda({ owner, mint, tokenProgram });
  return a;
}
