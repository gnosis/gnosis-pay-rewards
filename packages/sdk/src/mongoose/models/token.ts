import { Model, Mongoose, Schema } from 'mongoose';
import { Address, isAddressEqual } from 'viem';
import { mongooseSchemaAddressField } from './shared-schema-fields';
import { TokenFieldsType } from '../../database/token-zod.js';
import { GnoisPayTokenType } from '../../core/token-constants';

export const tokenModelName = 'Token' as const;
export const tokenCollectionName = 'tokens' as const;

const tokenSchema = new Schema<TokenFieldsType>(
  {
    _id: mongooseSchemaAddressField,
    symbol: {
      type: String,
      required: true,
    },
    decimals: {
      type: Number,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    chainId: {
      type: Number,
      required: true,
    },
    oracle: {
      ...mongooseSchemaAddressField,
      required: false,
    },
    address: {
      ...mongooseSchemaAddressField,
      required: true,
    },
    deploymentBlock: {
      type: Number,
      required: false,
    },
  },
  {
    _id: false, // Disable the _id field
    collection: tokenCollectionName,
    timestamps: true,
  },
)
  // Indexes for performance
  .index({ chainId: 1 })
  .index({ oracle: 1 });

export type TokenModelType = Model<TokenFieldsType>;

export function createTokenModel(mongooseConnection: Mongoose): TokenModelType {
  // Return cached model if it exists
  if (mongooseConnection.models[tokenModelName]) {
    return mongooseConnection.models[tokenModelName];
  }

  return mongooseConnection.model(tokenModelName, tokenSchema);
}

/**
 * Migrate the tokens to the database
 * Checks for missing tokens and adds them to the database
 * @param tokenModel - The token model
 * @param tokens - Array of tokens to save
 * @param clean - If true, delete all existing tokens before adding new ones
 */
export async function saveTokensToDatabase(tokenModel: TokenModelType, tokens: GnoisPayTokenType[], clean = false) {
  const mongooseSession = await tokenModel.startSession();
  mongooseSession.startTransaction();

  try {
    if (clean === true) {
      await tokenModel.deleteMany({}, { session: mongooseSession });
    }

    // Get all existing tokens from the database
    const existingTokens = await tokenModel.find(
      {},
      { _id: 1 },
      {
        session: mongooseSession,
      },
    );
    const existingTokenAddresses = existingTokens.map((t) => (t._id as Address).toLowerCase());

    // Normalize input tokens and check which ones are missing
    const tokensToAdd: TokenFieldsType[] = [];

    for (const token of tokens) {
      const normalizedAddress = token.address.toLowerCase() as Address;

      // Check if this token is missing from the database
      const isMissing = !existingTokenAddresses.some((existingAddress) => {
        return isAddressEqual(existingAddress as Address, normalizedAddress);
      });

      if (isMissing) {
        tokensToAdd.push({
          ...token,
          address: normalizedAddress,
          _id: normalizedAddress,
        });
      }
    }

    // Add missing tokens to the database
    if (tokensToAdd.length > 0) {
      await tokenModel.insertMany(tokensToAdd, { session: mongooseSession });
    }

    await mongooseSession.commitTransaction();
  } catch (error) {
    await mongooseSession.abortTransaction();
    throw error;
  } finally {
    await mongooseSession.endSession();
  }
}
