/** The dated, human-readable message a wallet signs to open its deposit addresses (no gas, no transaction). */
export const ownershipMessage = (owner: string, issuedAt: string) => `Landfall: open my deposit addresses\nOwner: ${owner}\nIssued: ${issuedAt}`;
