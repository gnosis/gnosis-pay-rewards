import { Schema, Mongoose, Model } from 'mongoose';
import { Address, isAddressEqual } from 'viem';
import { mongooseSchemaAddressField } from './sharedSchemaFields';
import { TokenDocumentFieldsType } from '../database/gnosisPayToken';
import { SerializableErc20TokenType } from '../gnoisPayTokens';

export const gnosisPayTokenModelName = 'Token' as const;

const gnosisPayTokenSchema = new Schema<TokenDocumentFieldsType>(
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
  },
  {
    _id: false, // Disable the _id field
    timestamps: true,
  },
)
  // Indexes for performance
  .index({ chainId: 1 })
  .index({ oracle: 1 });

export type TokenModelType = Model<TokenDocumentFieldsType>;

export function createTokenModel(mongooseConnection: Mongoose): TokenModelType {
  // Return cached model if it exists
  if (mongooseConnection.models[gnosisPayTokenModelName]) {
    return mongooseConnection.models[gnosisPayTokenModelName];
  }

  return mongooseConnection.model(gnosisPayTokenModelName, gnosisPayTokenSchema);
}

/**
 * Migrate the tokens to the database
 * @param mongooseClient - The mongoose client
 */
export async function saveGnosisPayTokensToDatabase(
  tokenModel: TokenModelType,
  tokens: SerializableErc20TokenType[],
  clean = false,
) {
  const mongooseSession = await tokenModel.startSession();
  mongooseSession.startTransaction();

  try {
    if (clean === true) {
      await tokenModel.deleteMany({}, { session: mongooseSession });
    }

    // Skip adding if the entries already exist
    const existingTokens = await tokenModel.find({}, { _id: 1 }, { session: mongooseSession });

    const gpTokensWithId = tokens
      .map(({ address, ...token }) => ({
        ...token,
        // Make sure the address is lowercase
        address: address.toLowerCase(),
        _id: address.toLowerCase(),
      }))
      // Remove tokens that exist in the existingTokens
      .filter(
        (token) =>
          !existingTokens.some((t) => {
            return isAddressEqual(t._id as Address, token._id as Address);
          }),
      );

    await tokenModel.insertMany(gpTokensWithId, { session: mongooseSession });
    await mongooseSession.commitTransaction();
  } catch (error) {
    await mongooseSession.abortTransaction();
    throw error;
  } finally {
    await mongooseSession.endSession();
  }
}
