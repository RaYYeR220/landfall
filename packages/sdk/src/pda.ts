import { PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, LANDFALL_PROGRAM_ID, SEEDS, TOKEN_PROGRAM_ID, USDC_MINT } from "./constants.js";

export const ata = (owner: PublicKey, mint: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];

export const vaultPda = (usdcMint: PublicKey = USDC_MINT, programId = LANDFALL_PROGRAM_ID): PublicKey =>
  PublicKey.findProgramAddressSync([SEEDS.vault, usdcMint.toBuffer()], programId)[0];

export const shareMintPda = (vault: PublicKey, programId = LANDFALL_PROGRAM_ID): PublicKey =>
  PublicKey.findProgramAddressSync([SEEDS.shares, vault.toBuffer()], programId)[0];

export const inboxPda = (vault: PublicKey, owner: PublicKey, programId = LANDFALL_PROGRAM_ID): PublicKey =>
  PublicKey.findProgramAddressSync([SEEDS.inbox, vault.toBuffer(), owner.toBuffer()], programId)[0];

/** Every address the vault uses, derived once. */
export const vaultAddresses = (usdcMint: PublicKey = USDC_MINT, programId = LANDFALL_PROGRAM_ID) => {
  const vault = vaultPda(usdcMint, programId);
  const shareMint = shareMintPda(vault, programId);
  return {
    programId,
    usdcMint,
    vault,
    shareMint,
    idle: ata(vault, usdcMint),
    deadShares: ata(vault, shareMint),
  };
};

export type VaultAddresses = ReturnType<typeof vaultAddresses>;

/** The owner's inbox and the USDC account its persistent deposit addresses pay into. */
export const inboxAddresses = (v: VaultAddresses, owner: PublicKey) => {
  const inbox = inboxPda(v.vault, owner, v.programId);
  return { inbox, inboxUsdc: ata(inbox, v.usdcMint), ownerShares: ata(owner, v.shareMint) };
};
