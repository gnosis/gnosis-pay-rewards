import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts';
import { getTokenUsdPrice } from './tokens';

export const BI_18 = BigInt.fromI32(18);
export class TokenAddressWithOracle {
  address: Address;
  oracle: Address;

  /**
   * @param address The address of the token
   * @param oracle The address of the oracle for the token. If token has no oracle, use addressZero
   */
  constructor(address: Address, oracle: Address) {
    this.address = address;
    this.oracle = oracle;
  }

  /**
   * @returns true if the token has an oracle, false otherwise
   */
  hasOracle(): boolean {
    return !this.oracle.equals(addressZero);
  }

  /**
   * @returns the token's USD price or null if the token has no oracle
   */
  // eslint-disable-next-line @typescript-eslint/ban-types
  getTokenUsdPrice(): BigDecimal | null {
    if (!this.hasOracle()) {
      return null;
    }

    const tokenUsdPrice = getTokenUsdPrice(this.oracle);
    return tokenUsdPrice;
  }
}

/**
 * Gnosis Pay Spend Address: the address that receives EURe, GBP and USDC from other GP Safes
 */
export const gnosisPaySpendAddress = Address.fromString('0x4822521E6135CD2599199c83Ea35179229A172EE');

/**
 * Gnosis Pay Spender Module Address
 */
export const gnosisPaySpenderModuleAddress = Address.fromString('0xcFF260bfbc199dC82717494299b1AcADe25F549b');

/**
 * Address zero
 */
export const addressZero = Address.fromString('0x0000000000000000000000000000000000000000');

/**
 * GNO token
 */
export const gnoToken = new TokenAddressWithOracle(
  Address.fromString('0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb'),
  Address.fromString('0x22441d81416430A54336aB28765abd31a792Ad37')
);

/**
 * EURe token
 */
export const eureToken = new TokenAddressWithOracle(
  Address.fromString('0xcB444e90D8198415266c6a2724b7900fb12FC56E'),
  Address.fromString('0xab70BCB260073d036d1660201e9d5405F5829b7a')
);

/**
 * GBP token
 */
export const gbpToken = new TokenAddressWithOracle(
  Address.fromString('0x5Cb9073902F2035222B9749F8fB0c9BFe5527108'),
  Address.fromString('0x0E418d54863a3fAfeC9e96a358795f0f236f5f66')
);

/**
 * USDC token
 */
export const usdcToken = new TokenAddressWithOracle(
  Address.fromString('0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83'),
  addressZero
);

/**
 * Circle bridged USDC token
 */
export const circleUsdcToken = new TokenAddressWithOracle(
  Address.fromString('0x833589fCD6eDb6E08B1Daf2d5FbB7C3C0d3C8268'),
  addressZero
);

export const tokenInfos: TokenAddressWithOracle[] = [gnoToken, eureToken, gbpToken, usdcToken, circleUsdcToken];

/**
 * Gnosis Pay Reward Distribution Safe Address.
 * The safe from which rewards are distributed to other safes.
 */
export const gnosisPayRewardDistributionSafeAddress = Address.fromString('0xCdF50be9061086e2eCfE6e4a1BF9164d43568EEC');
