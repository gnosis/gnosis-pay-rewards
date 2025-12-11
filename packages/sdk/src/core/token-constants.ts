import { Address, isAddressEqual } from 'viem';
import { SerializableErc20TokenType } from '@kpkpkg/apps-sdk/evm';

export type GnoisPayTokenType = SerializableErc20TokenType & {
  oracle?: Address;
  /**
   * The block number at which the token was deployed.
   * If provided, token snapshots will be skipped for blocks before this deployment block.
   */
  deploymentBlock?: number;
};

export const gnoToken: GnoisPayTokenType = {
  address: '0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb',
  symbol: 'GNO',
  decimals: 18,
  name: 'Gnosis',
  chainId: 100,
  oracle: '0x22441d81416430A54336aB28765abd31a792Ad37',
} as const;

export const circleUsdcToken: GnoisPayTokenType = {
  symbol: 'USDC',
  address: '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83',
  decimals: 6,
  name: 'USDC',
  chainId: 100,
};

export const moneriumEureToken: GnoisPayTokenType = {
  symbol: 'EURe',
  address: '0xcB444e90D8198415266c6a2724b7900fb12FC56E',
  decimals: 18,
  name: 'Monerium EUR emoney (EURe)',
  chainId: 100,
  oracle: '0xab70BCB260073d036d1660201e9d5405F5829b7a',
};

export const moneriumGbpToken: GnoisPayTokenType = {
  symbol: 'GBPe',
  address: '0x5Cb9073902F2035222B9749F8fB0c9BFe5527108',
  decimals: 18,
  name: 'Monerium GBP emoney (GBPe)',
  chainId: 100,
  oracle: '0x0E418d54863a3fAfeC9e96a358795f0f236f5f66',
};

export const usdcBridgeToken: GnoisPayTokenType = {
  symbol: 'USDC.e',
  address: '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0',
  decimals: 6,
  name: 'Bridged USDC (Gnosis)',
  chainId: 100,
};

/**
 * CRC (Circles) token for Metri safe rewards
 * TODO: Update with the actual CRC token address when available
 */
export const gCrcToken: GnoisPayTokenType = {
  symbol: 's-gCRC',
  address: '0x548c20e6c24e4876e20dadbeab75362e2f5a4bc1',
  decimals: 18,
  name: 'Circles',
  chainId: 100,
  deploymentBlock: 43193728,
};

/**
 * The gCRC token for the price provider, the other token has no liquidity on CoW Protocol
 */
export const gCrcTokenForPriceProvider: GnoisPayTokenType = {
  symbol: 's-gCRC',
  address: '0xeeF7B1f06B092625228C835Dd5D5B14641D1e54A',
  decimals: 18,
  name: 'Circles',
  chainId: 100,
  deploymentBlock: 43193728,
};

export const safeToken: GnoisPayTokenType = {
  symbol: 'SAFE',
  address: '0x4d18815d14fe5c3304e87b3fa18318baa5c23820',
  decimals: 18,
  name: 'SAFE',
  chainId: 100,
  deploymentBlock: 33585811,
};

/**
 * List of token used to process payments in Gnosis Pay as of July 1, 2024
 */
export const gnosisPayTokens: GnoisPayTokenType[] = [
  circleUsdcToken,
  moneriumEureToken,
  moneriumGbpToken,
  usdcBridgeToken,
];

/**
 * List of tokens used to take token balance snapshots
 * This is used to ensure that we are taking snapshots of the correct tokens
 * and to avoid taking snapshots of tokens that are not used in the Gnosis Pay system
 */
export const tokenBalanceSnapshotTokens: GnoisPayTokenType[] = [gnoToken, safeToken, gCrcToken];

export function getGnosisPayTokenByAddress(tokenAddress: Address): GnoisPayTokenType | undefined {
  return gnosisPayTokens.find((token) => isAddressEqual(token.address, tokenAddress));
}
