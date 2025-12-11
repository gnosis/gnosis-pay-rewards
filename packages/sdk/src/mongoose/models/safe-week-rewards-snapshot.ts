/* eslint-disable @typescript-eslint/no-explicit-any */
import { Address, isAddress, isAddressEqual } from 'viem';
import { ClientSession, HydratedDocument, Model, Mongoose, Schema } from 'mongoose';
import { z } from 'zod';
import { SafeWeekRewardsSnapshotDocumentFieldsType } from '../../database/safe-rewards-week-snapshot-zod.js';
import { isValidWeekId, WeekIdFormatType } from '../../week-functions.js';
import { tokenBalanceSnapshotModelName } from './token-balance-snapshot.js';
import { mongooseSchemaAddressField } from './shared-schema-fields.js';
import { gnosisPaySafeModelName, gnosisPayTransactionModelName } from './model-config.js';
import { rewardTransactionModelName } from './reward-transaction.js';
import { tokenModelName } from './token.js';

export const safeWeekRewardsSnapshotModelName = 'SafeWeekRewardsSnapshot' as const;
export const safeWeekRewardsSnapshotCollectionName = 'safe_week_rewards_snapshots' as const;

/**
 * Zod schema for validating reward objects (used for both estimatedRewards and earnedRewards)
 */
export const rewardPerTokenZodSchema = z
  .object({
    token: z
      .string()
      .refine((val) => isAddress(val), {
        message: 'Token address must be a valid Ethereum address',
      })
      .describe('The token address'),
    valueUSD: z.number().finite().describe('The USD value of the reward'),
    amount: z.number().finite().describe('The token amount (formatted)'),
    amountRaw: z
      .string()
      .min(1, 'amountRaw must be a non-empty string')
      .describe('The raw token amount as a string (e.g., in wei)'),
  })
  .describe('Reward per token object');

export type RewardPerTokenType = z.infer<typeof rewardPerTokenZodSchema>;

const rewardsPerTokenSchema = new Schema<SafeWeekRewardsSnapshotDocumentFieldsType['estimatedRewards'][number]>({
  token: {
    type: String,
    ref: tokenModelName,
    required: true,
  },
  valueUSD: {
    type: Number,
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  amountRaw: {
    type: String,
    required: true,
  },
});

const safeWeekRewardsSnapshotSchema = new Schema<SafeWeekRewardsSnapshotDocumentFieldsType>(
  {
    _id: {
      type: String,
      required: true,
      validate(value: string) {
        const [week, address] = value.split('/');

        return isValidWeekId(week) && isAddress(address);
      },
      message: '{VALUE} is not a valid week ID. Expected format: YYYY-MM-DD',
    },
    safe: {
      ...mongooseSchemaAddressField,
      ref: gnosisPaySafeModelName,
      required: true,
    },
    week: {
      type: String,
      required: true,
    },
    netVolumeUSD: {
      type: Number,
      required: true,
    },
    estimatedRewards: [rewardsPerTokenSchema],
    earnedRewards: [
      {
        type: String,
        ref: rewardTransactionModelName,
      },
    ],
    transactions: [
      {
        type: String,
        ref: gnosisPayTransactionModelName,
      },
    ],
    tokenBalanceSnapshots: [
      {
        type: String,
        ref: tokenBalanceSnapshotModelName,
      },
    ],
  },
  {
    collection: safeWeekRewardsSnapshotCollectionName,
    timestamps: true,
  },
)
  // Critical indexes for performance
  .index({ week: 1 }) // For queries by week
  .index({ safe: 1, week: -1 }) // For queries by safe address and week (most recent first)
  .index({ safe: 1 }) // For queries by safe address only
  .index({ netVolumeUSD: -1 }); // For sorting by volume

/**
 * Instance method to add a tokenBalanceSnapshotId to the document with validation
 * @param tokenSnapshotId - The token balance snapshot document ID in format: <blockNumber>/<safeAddress>/<tokenAddress>
 * @param options - Optional configuration
 * @param options.save - Whether to save the document after appending (default: false)
 * @param options.session - Optional mongoose session for the save operation
 * @returns The document instance (for chaining)
 * @throws Error if tokenSnapshotId format is invalid
 * @note If the tokenSnapshotId already exists in the array, it will be ignored (no error thrown)
 */
safeWeekRewardsSnapshotSchema.methods.addTokenBalanceSnapshotId = function addTokenBalanceSnapshotId(
  tokenSnapshotId: string,
  options?: { save?: boolean; session?: ClientSession },
): any {
  // Validate tokenSnapshotId format: <blockNumber>/<safeAddress>/<tokenAddress>
  const parts = tokenSnapshotId.split('/');
  if (parts.length !== 3) {
    throw new Error(
      `Invalid tokenSnapshotId format: ${tokenSnapshotId}. Expected format: <blockNumber>/<safeAddress>/<tokenAddress>`,
    );
  }

  const [blockNumber, safeAddress, tokenAddress] = parts;

  // Validate blockNumber is a valid number
  if (isNaN(Number(blockNumber)) || Number(blockNumber) <= 0) {
    throw new Error(
      `Invalid blockNumber in tokenSnapshotId: ${tokenSnapshotId}. Block number must be a positive integer.`,
    );
  }

  // Validate addresses
  if (!isAddress(safeAddress)) {
    throw new Error(
      `Invalid safeAddress in tokenSnapshotId: ${tokenSnapshotId}. Safe address must be a valid Ethereum address.`,
    );
  }

  if (!isAddress(tokenAddress)) {
    throw new Error(
      `Invalid tokenAddress in tokenSnapshotId: ${tokenSnapshotId}. Token address must be a valid Ethereum address.`,
    );
  }

  // Validate that the safeAddress in tokenSnapshotId matches the document's safe address
  const normalizedSafeAddress = safeAddress.toLowerCase() as Address;
  const documentSafeAddress = (this.safe as string).toLowerCase();
  if (normalizedSafeAddress !== documentSafeAddress) {
    throw new Error(
      `Safe address mismatch: tokenSnapshotId contains ${normalizedSafeAddress}, but document is for ${documentSafeAddress}`,
    );
  }

  // Check if tokenSnapshotId already exists in the array - if so, ignore it
  if (this.tokenBalanceSnapshots.includes(tokenSnapshotId)) {
    return this;
  }

  // Append the tokenSnapshotId to the array
  this.tokenBalanceSnapshots.push(tokenSnapshotId);

  // Save if requested
  if (options?.save) {
    return this.save({ session: options.session });
  }

  return this;
};

/**
 * Instance method to add an estimated reward to the document with validation
 * @param reward - The estimated reward object with token, valueUSD amount, and amountRaw
 * @param options - Optional configuration
 * @param options.save - Whether to save the document after appending (default: false)
 * @param options.session - Optional mongoose session for the save operation
 * @param options.updateIfExists - Whether to update the reward if it already exists for the token (default: false, will skip if exists)
 * @returns The document instance (for chaining)
 * @throws Error if reward data is invalid
 */
safeWeekRewardsSnapshotSchema.methods.addEstimatedReward = function addEstimatedReward(
  reward: RewardPerTokenType,
  options?: {
    save?: boolean;
    session?: ClientSession;
    updateIfExists?: boolean;
  },
): any {
  // Validate reward using Zod schema
  const validatedReward = rewardPerTokenZodSchema.parse(reward);
  // Check if reward for this token already exists
  const existingIndex = this.estimatedRewards.findIndex((r: { token: string }) =>
    isAddressEqual(r.token as Address, validatedReward.token as Address),
  );

  if (existingIndex !== -1) {
    if (options?.updateIfExists) {
      // Update existing reward
      this.estimatedRewards[existingIndex] = validatedReward;
    } else {
      // Skip if exists and updateIfExists is false
      return this;
    }
  } else {
    // Add new reward
    this.estimatedRewards.push(validatedReward);
  }

  // Save if requested
  if (options?.save) {
    return this.save({ session: options.session });
  }

  return this;
};

/**
 * Instance method to add an earned reward transaction reference to the document
 * @param rewardTransactionId - The reward transaction document ID
 * @param options - Optional configuration
 * @param options.save - Whether to save the document after appending (default: false)
 * @param options.session - Optional mongoose session for the save operation
 * @returns The document instance (for chaining)
 * @note If the rewardTransactionId already exists in the array, it will be ignored (no error thrown)
 */
safeWeekRewardsSnapshotSchema.methods.addEarnedReward = function addEarnedReward(
  rewardTransactionId: string,
  options?: { save?: boolean; session?: ClientSession },
): any {
  // Validate that rewardTransactionId is a non-empty string
  if (typeof rewardTransactionId !== 'string' || rewardTransactionId.trim() === '') {
    throw new Error(`Invalid rewardTransactionId: ${rewardTransactionId}. Must be a non-empty string.`);
  }

  // Check if rewardTransactionId already exists in the array - if so, ignore it
  if (this.earnedRewards.includes(rewardTransactionId)) {
    return this;
  }

  // Append the rewardTransactionId to the array
  this.earnedRewards.push(rewardTransactionId);

  // Save if requested
  if (options?.save) {
    return this.save({ session: options.session });
  }

  return this;
};

safeWeekRewardsSnapshotSchema.statics.createDocumentId = function createDocumentId(
  week: WeekIdFormatType,
  address: Address,
): `${WeekIdFormatType}/${Address}` {
  return `${week}/${address.toLowerCase() as Address}`;
};

export type SafeWeekRewardsSnapshotModelType = Model<SafeWeekRewardsSnapshotDocumentFieldsType> & {
  /**
   * Create a document id for the week cashback reward in the format of week/address
   * @param week - e.g. 2024-03-01
   * @param address - e.g. 0x123456789abcdef123456789abcdef123456789ab
   * @returns `2024-03-01/0x123456789abcdef123456789abcdef123456789ab`
   *
   * @example
   * const docId = createWeekCashbackRewardDocumentId('2024-03-01', '0x123456789abcdef123456789abcdef123456789ab')
   * // '2024-03-01/0x123456789abcdef123456789abcdef123456789ab'
   */
  createDocumentId: (week: WeekIdFormatType, address: Address) => `${WeekIdFormatType}/${Address}`;
};

/**
 * Document type that includes instance methods
 */
export type SafeWeekRewardsSnapshotDocumentType = HydratedDocument<SafeWeekRewardsSnapshotDocumentFieldsType> & {
  /**
   * Add a tokenBalanceSnapshotId to the document with validation
   * @param tokenSnapshotId - The token balance snapshot document ID in format: <blockNumber>/<safeAddress>/<tokenAddress>
   * @param options - Optional configuration
   * @param options.save - Whether to save the document after appending (default: false)
   * @param options.session - Optional mongoose session for the save operation
   * @returns The document instance (for chaining) or a Promise if save is true
   * @throws Error if tokenSnapshotId format is invalid
   * @note If the tokenSnapshotId already exists in the array, it will be ignored (no error thrown)
   */
  addTokenBalanceSnapshotId: (
    tokenSnapshotId: string,
    options?: { save?: boolean; session?: ClientSession },
  ) => SafeWeekRewardsSnapshotDocumentType | Promise<SafeWeekRewardsSnapshotDocumentType>;
  /**
   * Add an estimated reward to the document with validation
   * @param reward - The estimated reward object with token, valueUSD amount, and amountRaw
   * @param options - Optional configuration
   * @param options.save - Whether to save the document after appending (default: false)
   * @param options.session - Optional mongoose session for the save operation
   * @param options.updateIfExists - Whether to update the reward if it already exists for the token (default: false)
   * @returns The document instance (for chaining) or a Promise if save is true
   * @throws Error if reward data is invalid
   */
  addEstimatedReward: (
    reward: RewardPerTokenType,
    options?: {
      save?: boolean;
      session?: ClientSession;
      updateIfExists?: boolean;
    },
  ) => SafeWeekRewardsSnapshotDocumentType | Promise<SafeWeekRewardsSnapshotDocumentType>;
  /**
   * Add an earned reward transaction reference to the document
   * @param rewardTransactionId - The reward transaction document ID
   * @param options - Optional configuration
   * @param options.save - Whether to save the document after appending (default: false)
   * @param options.session - Optional mongoose session for the save operation
   * @returns The document instance (for chaining) or a Promise if save is true
   * @note If the rewardTransactionId already exists in the array, it will be ignored (no error thrown)
   */
  addEarnedReward: (
    rewardTransactionId: string,
    options?: { save?: boolean; session?: ClientSession },
  ) => SafeWeekRewardsSnapshotDocumentType | Promise<SafeWeekRewardsSnapshotDocumentType>;
};

export function createSafeWeekRewardsSnapshotModel(mongoose: Mongoose): SafeWeekRewardsSnapshotModelType {
  return (mongoose.models[safeWeekRewardsSnapshotModelName] ??
    mongoose.model(safeWeekRewardsSnapshotModelName, safeWeekRewardsSnapshotSchema)) as any;
}

/**
 * Creates (or returns the week) cashback reward document
 */
export async function createSafeWeekRewardsSnapshotDocument(
  model: SafeWeekRewardsSnapshotModelType,
  payload: {
    week: WeekIdFormatType;
    address: Address;
  },
  session?: ClientSession,
): Promise<SafeWeekRewardsSnapshotDocumentType> {
  const address = payload.address.toLowerCase() as Address;
  const documentId = model.createDocumentId(payload.week, address);
  const document = await model.findById(documentId, {}, { session });

  if (document === null) {
    return (await new model<SafeWeekRewardsSnapshotDocumentFieldsType>({
      _id: documentId,
      safe: address,
      week: payload.week,
      netVolumeUSD: 0,
      estimatedRewards: [],
      earnedRewards: [],
      transactions: [],
      tokenBalanceSnapshots: [],
    }).save({ session })) as SafeWeekRewardsSnapshotDocumentType;
  }

  return document as SafeWeekRewardsSnapshotDocumentType;
}
