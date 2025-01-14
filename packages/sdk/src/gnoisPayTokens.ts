import { Address, isAddressEqual } from 'viem';

export type SerializableErc20TokenType = {
  address: Address;
  symbol: string;
  decimals: number;
  name: string;
  chainId: number;
  oracle?: Address;
};

export const gnoToken: SerializableErc20TokenType = {
  address: '0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb',
  symbol: 'GNO',
  decimals: 18,
  name: 'Gnosis',
  chainId: 100,
  oracle: '0x22441d81416430A54336aB28765abd31a792Ad37',
} as const;

export const circleUsdcToken: SerializableErc20TokenType = {
  symbol: 'USDC',
  address: '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83',
  decimals: 6,
  name: 'USDC',
  chainId: 100,
};

export const moneriumEureToken: SerializableErc20TokenType = {
  symbol: 'EURe',
  address: '0xcB444e90D8198415266c6a2724b7900fb12FC56E',
  decimals: 18,
  name: 'Monerium EUR emoney (EURe)',
  chainId: 100,
  oracle: '0xab70BCB260073d036d1660201e9d5405F5829b7a',
};

export const moneriumGbpToken: SerializableErc20TokenType = {
  symbol: 'GBPe',
  address: '0x5Cb9073902F2035222B9749F8fB0c9BFe5527108',
  decimals: 18,
  name: 'Monerium GBP emoney (GBPe)',
  chainId: 100,
  oracle: '0x0E418d54863a3fAfeC9e96a358795f0f236f5f66',
};

export const usdcBridgeToken: SerializableErc20TokenType = {
  symbol: 'USDC.e',
  address: '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0',
  decimals: 6,
  name: 'Bridged USDC (Gnosis)',
  chainId: 100,
};

/**
 * List of token used to process payments in Gnosis Pay as of July 1, 2024
 */
export const gnosisPayTokens: SerializableErc20TokenType[] = [
  circleUsdcToken,
  moneriumEureToken,
  moneriumGbpToken,
  usdcBridgeToken,
] as const;

export function getGnosisPayTokenByAddress(tokenAddress: Address) {
  return gnosisPayTokens.find((token) => isAddressEqual(token.address, tokenAddress));
}
