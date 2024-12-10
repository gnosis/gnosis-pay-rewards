import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts';
import { PriceOracle as PriceOracleContract } from '../generated/GnosisPaySpender/PriceOracle';
import { Token } from '../generated/schema';
import { Erc20 } from '../generated/templates/GnosisPayToken/Erc20';
import { Erc20Bytes } from '../generated/templates/GnosisPayToken/Erc20Bytes';
import { GnosisPayToken as GnosisPayTokenTemplate } from '../generated/templates';
import { tokenInfos, addressZero, TokenAddressWithOracle,    } from './constants';

const circleBridgedUsdcAddress = Address.fromString('0x2a22f9c3b484c3629090feed35f17ff8f88f76f0');

export function createTokenEntity(tokenAddress: Address): Token {
  const entityId = tokenAddress.toHexString();
  let tokenEntity = Token.load(entityId);

  if (tokenEntity === null) {
    let tokenOracleAddress = addressZero;
    for (let i = 0; i < tokenInfos.length; i++) {
      const _tokenInfo = tokenInfos[i];
      if (_tokenInfo.address.equals(tokenAddress)) {
        tokenOracleAddress = _tokenInfo.oracle;
        break;
      }
    }

    tokenEntity = new Token(entityId);

    const tokenContract = Erc20.bind(tokenAddress);
    const tokenBytesContract = Erc20Bytes.bind(tokenAddress);

    tokenEntity.address = tokenAddress;

    const tryName = tokenContract.try_name();
    const trySymbol = tokenContract.try_symbol();
    const tryDecimals = tokenContract.try_decimals();
    // Bytes
    const tryNameBytes = tokenBytesContract.try_name();
    const trySymbolBytes = tokenBytesContract.try_symbol();

    if (!tryName.reverted) {
      tokenEntity.name = tryName.value;
    } else if (!tryNameBytes.reverted) {
      tokenEntity.name = tryNameBytes.value.toString();
    } else if (tokenAddress.equals(circleBridgedUsdcAddress)) {
      tokenEntity.name = 'Bridged USDC (Gnosis)';
    } else {
      tokenEntity.name = 'Unknown';
    }

    if (!trySymbol.reverted) {
      tokenEntity.symbol = trySymbol.value;
    } else if (!trySymbolBytes.reverted) {
      tokenEntity.symbol = trySymbolBytes.value.toString();
    } else if (tokenAddress.equals(circleBridgedUsdcAddress)) {
      tokenEntity.symbol = 'USDC.e';
    } else {
      tokenEntity.symbol = 'UNKNOWN';
    }

    if (!tryDecimals.reverted) {
      tokenEntity.decimals = BigInt.fromI32(tryDecimals.value);
    } else if (tokenAddress.equals(circleBridgedUsdcAddress)) {
      tokenEntity.decimals = BigInt.fromI32(6);
    } else {
      tokenEntity.decimals = BigInt.fromI32(18);
    }

    // Meta
    tokenEntity.chainId = 100;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    tokenEntity.oracle = tokenOracleAddress;
    // Save
    tokenEntity.save();

    // Start listening to events
    GnosisPayTokenTemplate.create(tokenAddress);
  }

  return tokenEntity as Token;
}

/**
 * Convert a token entity to a token address with oracle
 * @param tokenEntity The token entity
 * @returns The token address with oracle
 */
export function tokenEntityToTokenAddressWithOracle(tokenEntity: Token): TokenAddressWithOracle {
  return new TokenAddressWithOracle(Address.fromBytes(tokenEntity.address), Address.fromBytes(tokenEntity.oracle));
}

/**
/**
 * Check if all the tokens are migrated
 * @returns
 */
export function areTokensMigrated(): boolean {
  return Token.load(tokenInfos[0].address.toHexString()) != null;
}

/**
 * Migrate all the tokens to the database
 */
export function migrateTokens(): void {
  if (areTokensMigrated()) {
    return;
  }

  for (let i = 0; i < tokenInfos.length; i++) {
    const _tokenInfo = tokenInfos[i];
    createTokenEntity(_tokenInfo.address);
  }
}

/**
 * Get the USD price of a token from the Price Oracle
 * @param tokenOracleAddress The address of the token's Price Oracle
 * @returns The USD price of the token
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export function getTokenUsdPrice(tokenOracleAddress: Address): BigDecimal {
  const tokenOracleContract = PriceOracleContract.bind(tokenOracleAddress);

  const oracleDecimals = BigInt.fromI32(tokenOracleContract.decimals());
  const roundData = tokenOracleContract.latestRoundData();

  return formatUnits(roundData.getAnswer(), oracleDecimals);
}

/**
 * Check if a token is supported by the subgraph
 * @param tokenAddress The address of the token
 * @returns True if the token is supported, false otherwise
 */
export function isTokenSupported(tokenAddress: Address): boolean {
  let isSupported = false;

  for (let i = 0; i < tokenInfos.length; i++) {
    const tokenInfo = tokenInfos[i];
    if (tokenInfo.address.equals(tokenAddress)) {
      isSupported = true;
      break;
    }
  }

  return isSupported;
}

/**
 * Format a token amount to the decimal precision of the exchange
 * @param tokenAmount The token amount
 * @param exchangeDecimals The decimal precision of the exchange
 * @returns The formatted token amount
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export function formatUnits(tokenAmount: BigInt, exchangeDecimals: BigInt): BigDecimal {
  if (exchangeDecimals == BigInt.fromI32(0)) {
    return tokenAmount.toBigDecimal();
  }
  return tokenAmount.toBigDecimal().div(exponentToBigDecimal(exchangeDecimals));
}

// eslint-disable-next-line @typescript-eslint/ban-types
export function exponentToBigDecimal(decimals: BigInt): BigDecimal {
  let resultString = '1';

  for (let i = 0; i < decimals.toI32(); i++) {
    resultString += '0';
  }

  return BigDecimal.fromString(resultString);
}
