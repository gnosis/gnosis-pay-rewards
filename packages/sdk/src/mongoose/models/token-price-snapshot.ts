import { Mongoose, PaginateModel, Schema } from 'mongoose';
import mongoosePaginate from 'mongoose-paginate-v2';
import { mongooseSchemaAddressField } from './shared-schema-fields.js';
import { tokenModelName } from './token.js';
import { TokenPriceSnapshotFieldsType } from '../../database/token-price-snapshot-zod.js';
import { blockModelName } from './block.js';

export const tokenPriceSnapshotModelName = 'TokenPriceSnapshot' as const;
export const tokenPriceSnapshotCollectionName = 'token_price_snapshots' as const;

const tokenPriceSnapshotSchema = new Schema<TokenPriceSnapshotFieldsType>(
  {
    _id: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    block: {
      ref: blockModelName,
      type: Number,
      required: true,
    },
    token: {
      ...mongooseSchemaAddressField,
      ref: tokenModelName,
      required: true,
    },
  },
  {
    _id: false, // Disable auto _id since we're providing our own
    collection: tokenPriceSnapshotCollectionName,
    timestamps: true,
  },
)
  .index({ token: 1, block: -1 })
  .index({ block: 1, token: 1 }) // For date range queries with token filter
  .plugin(mongoosePaginate);

tokenPriceSnapshotSchema.statics.createDocumentId = function createDocumentId(
  blockNumber: number,
  tokenAddress: string,
) {
  return `${blockNumber}/${tokenAddress.toLowerCase()}`;
};

export type TokenPriceSnapshotModelType = PaginateModel<TokenPriceSnapshotFieldsType> & {
  /**
   * Create a document ID from a block number and token address.
   * @param blockNumber - The block number.
   * @param tokenAddress - The token address.
   * @returns The document ID as `<blockNumber>/<tokenAddress>`
   */
  createDocumentId(blockNumber: number, tokenAddress: string): string;
};

export function createTokenPriceSnapshotModel(mongoose: Mongoose): TokenPriceSnapshotModelType {
  return (mongoose.models[tokenPriceSnapshotModelName] ??
    mongoose.model(tokenPriceSnapshotModelName, tokenPriceSnapshotSchema)) as unknown as TokenPriceSnapshotModelType;
}
