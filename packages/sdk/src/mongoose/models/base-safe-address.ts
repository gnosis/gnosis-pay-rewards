import { Schema } from 'mongoose';
import { Address } from 'viem';
import { mongooseSchemaAddressField } from './shared-schema-fields.js';
import { tokenBalanceSnapshotModelName } from './token-balance-snapshot.js';

/**
 * Base schema fields shared between GnosisPaySafeAddress and MetriSafeAddress
 * Both have volume fields and GNO snapshots, but only GnosisPaySafeAddress has transactions
 */
export const baseSafeSchemaFields = {
  _id: mongooseSchemaAddressField,
  address: mongooseSchemaAddressField,
  owners: [mongooseSchemaAddressField],
  isOG: {
    type: Boolean,
    required: true,
  },
  tokenBalanceSnapshots: [
    {
      ref: tokenBalanceSnapshotModelName,
      type: String,
      required: true,
    },
  ],
} as const;

/**
 * Base schema for Safe addresses
 * This schema contains common fields shared between GnosisPaySafeAddress and MetriSafeAddress
 * Note: transactions are only in GnosisPaySafeAddress, not in MetriSafeAddress
 */
export const baseSafeSchema = new Schema(baseSafeSchemaFields, {
  timestamps: true,
})
  // Critical indexes for performance
  .index({ owners: 1 });

/**
 * Base type for Safe address documents
 */
export type BaseSafeDocumentFieldsType = {
  _id: Address;
  address: Address;
  /**
   * If the safe is an original Gnosis Pay Safe
   */
  isOG: boolean;
  owners: Address[];
  tokenBalanceSnapshots: string[];
};
