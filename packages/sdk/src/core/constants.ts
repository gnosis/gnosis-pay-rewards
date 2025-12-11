/**
 * Gnosis Pay Spend Address: the address that receives EURe, GBP and USDC from other GP Safes
 */
export const gnosisPaySpendAddress = '0x4822521E6135CD2599199c83Ea35179229A172EE' as const;

/**
 * Gnosis Pay Spender Module Address
 */
export const gnosisPaySpenderModuleAddress = '0xcFF260bfbc199dC82717494299b1AcADe25F549b' as const;

/**
 * Gnosis Pay start block, use this for indexing Gnosis Pay events.
 * This block https://gnosisscan.io/block/35536000
 * Aug-18-2024 12:00:35 AM +UTC
 */
export const gnosisPayStartBlock = 35_536_000;

/**
 * Gnosis Pay OG NFT address
 */
export const gnosisPayOgNftAddress = '0x88997988a6A5aAF29BA973d298D276FE75fb69ab' as const;

/**
 * Gnosis Pay OG NFT V2 address.
 */
export const gnosisPayOgNftV2Address = '0x106c07DD0e77eF4D9C0c612e70E843afAA8E5699' as const;

/**
 * Reward safes addresses
 */
export const payoutSafes = {
  gnosisPay: '0xCdF50be9061086e2eCfE6e4a1BF9164d43568EEC',
  metri: '0x7aBE74B71F2958B624Cb2bE0596678784c0Caf6A',
} as const;
