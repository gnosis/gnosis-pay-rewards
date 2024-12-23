/**
 * The state of the indexer
 */
export type IndexerStateAtomType = {
  /**
   * The time the indexer started
   */
  startedAt: number;
  /**
   * Start block to index from
   */
  startBlock: bigint;
  /**
   * The block size to index in each fetch
   */
  fetchBlockSize: bigint;
  /**
   * Distance to latest block in block numbers
   */
  distanceToLatestBlockNumber: bigint;
  /**
   * Latest block number, used to calculate the distance to the latest block
   */
  latestBlockNumber: bigint;
  /**
   * The range of blocks to index
   */
  range: {
    /**
     * From block number
     */
    fromBlockNumber: bigint;
    /**
     * To block number
     */
    toBlockNumber: bigint;
  };
};
