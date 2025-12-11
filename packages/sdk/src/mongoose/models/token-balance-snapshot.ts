import { ClientSession, Mongoose, PaginateModel, Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import { Address, isAddress } from 'viem';

import { TokenBalanceSnapshotFieldsType } from '../../database/token-balance-snapshot-zod.js';
import { mongooseSchemaAddressField, mongooseSchemaWeekIdField } from './shared-schema-fields.js';
import { tokenModelName } from './token.js';
import { blockModelName } from './block.js';

export const tokenBalanceSnapshotModelName = 'TokenBalanceSnapshot' as const;
export const tokenBalanceSnapshotCollectionName = 'token_balance_snapshots' as const;

const tokenBalanceSnapshotSchema = new Schema<TokenBalanceSnapshotFieldsType>(
  {
    _id: {
      type: String,
      required: true,
      validate: {
        validator: (v: string) => {
          const [blockNumber, safeAddress, tokenAddress] = v.split('/');

          return isAddress(safeAddress) && isAddress(tokenAddress) && !isNaN(Number(blockNumber));
        },
        message:
          'Invalid Gnosis Token Balance Snapshot document id: {VALUE}. Expected format: <blockNumber>/<safeAddress>/<tokenAddress>',
      },
    },
    week: mongooseSchemaWeekIdField,
    address: {
      ...mongooseSchemaAddressField,
      required: true,
    },
    balanceRaw: { type: String, required: true },
    balance: { type: Number, required: true },
    token: {
      ...mongooseSchemaAddressField,
      required: true,
      ref: tokenModelName,
    },
    block: {
      type: Number,
      required: true,
      ref: blockModelName,
    },
    transactionHash: {
      type: String,
      required: false,
      default: null,
    },
  },
  {
    _id: false,
    collection: tokenBalanceSnapshotCollectionName,
  },
)
  // composite index
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  .index({ address: 1, block: 1, token: 1 }, { unique: true })
  // Additional indexes for performance
  .index({ week: 1 }) // For queries by week
  .index({ address: 1, week: 1 }) // For queries by address and week
  .index({ block: -1 }) // For time-based queries
  .index({ address: 1, block: -1 }) // For address-specific time queries
  .pre('save', function (next) {
    this.address = this.address.toLowerCase() as Address;
    if (this.token && typeof this.token === 'string') {
      this.token = this.token.toLowerCase() as Address;
    }
    next();
  })
  .plugin(mongoosePaginate);

tokenBalanceSnapshotSchema.statics.createDocumentId = function createDocumentId(
  blockNumber: number,
  safeAddress: Address,
  tokenAddress: Address,
) {
  return `${blockNumber}/${safeAddress.toLowerCase()}/${tokenAddress.toLowerCase()}` as `${number}/${Address}/${Address}`;
};

export type TokenBalanceSnapshotModelType = PaginateModel<TokenBalanceSnapshotFieldsType> & {
  /**
   * Creates a new Gnosis Token Balance Snapshot document id
   * @param blockNumber the block number
   * @param safeAddress the safe address
   * @param tokenAddress the token address
   * @returns
   */
  createDocumentId: (
    blockNumber: number,
    safeAddress: Address,
    tokenAddress: Address,
  ) => `${number}/${Address}/${Address}`;
};

export function createTokenBalanceSnapshotModel(mongoose: Mongoose): TokenBalanceSnapshotModelType {
  return (mongoose.models[tokenBalanceSnapshotModelName] ??
    mongoose.model(
      tokenBalanceSnapshotModelName,
      tokenBalanceSnapshotSchema,
    )) as unknown as TokenBalanceSnapshotModelType;
}

/**
 * Creates a new Gnosis Token Balance Snapshot document for a safe
 * @param gnosisTokenBalanceSnapshotModel
 * @param payload
 * @param session
 * @returns
 */
export function createGnosisTokenBalanceSnapshotDocument(
  model: TokenBalanceSnapshotModelType,
  payload: Omit<TokenBalanceSnapshotFieldsType, '_id'>,
  session?: ClientSession,
) {
  const tokenAddress = payload.token as Address;
  const _id = model.createDocumentId(payload.block, payload.address, tokenAddress);

  return new model<TokenBalanceSnapshotFieldsType>({
    _id,
    ...payload,
  }).save({
    session,
  });
}
