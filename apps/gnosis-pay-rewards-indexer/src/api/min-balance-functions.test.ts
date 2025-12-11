import { assertEquals } from '@std/assert';
import { restore, spy } from '@std/testing/mock';
import { findLowestMetriWalletGnoBalance } from './min-balance-functions.ts';
import { gnoToken } from '@kpk/gnosis-pay-rewards-sdk';
import type { Address } from 'viem';
import type { TokenBalanceSnapshotFieldsType, TokenFieldsType, WeekIdFormatType } from '@kpk/gnosis-pay-rewards-sdk';
import type { CreateModelsReturnType } from '@kpk/gnosis-pay-rewards-sdk/mongoose';

type TargetModelType = CreateModelsReturnType['tokenBalanceSnapshotModel'];

type TokenBalanceSnapshotWithTokenFieldsType = Omit<TokenBalanceSnapshotFieldsType, 'token'> & {
  token: TokenFieldsType;
};

Deno.test('findLowestMetriWalletGnoBalance', async (t) => {
  const metriSafeAddress = '0xed1afb38731ce824d51e01ef733b0031b69fead9' as Address;
  const gnosisPaySafeAddress = '0x26d37e6e92002097e7306d2a02a80817d02f3707' as Address;
  const week = '2025-11-30' as WeekIdFormatType;
  const gnoTokenAddress = gnoToken.address.toLowerCase() as Address;

  const mockGnoToken: TokenFieldsType = {
    _id: gnoTokenAddress,
    address: gnoTokenAddress,
    symbol: 'GNO',
    name: 'Gnosis',
    decimals: 18,
    chainId: 100,
  };

  // Mock class for chainable Mongoose query
  class MockQuery {
    private leanResult: Promise<TokenBalanceSnapshotWithTokenFieldsType[]>;

    constructor(leanResult: Promise<TokenBalanceSnapshotWithTokenFieldsType[]>) {
      this.leanResult = leanResult;
    }

    populate() {
      return this;
    }

    sort() {
      return this;
    }

    lean() {
      return this.leanResult;
    }
  }

  let mockTokenBalanceSnapshotModel: {
    find: (query: { address: Address }) => MockQuery;
  };

  // Helper function to create a mock chainable query
  const createMockQuery = (leanResult: Promise<TokenBalanceSnapshotWithTokenFieldsType[]>) => {
    return new MockQuery(leanResult);
  };

  await t.step('returns 0 when gnosisPaySafeAddress is null and Metri has no snapshots', async () => {
    const findSpy = spy(() => createMockQuery(Promise.resolve([])));
    mockTokenBalanceSnapshotModel = {
      find: findSpy,
    };

    const result = await findLowestMetriWalletGnoBalance({
      metriSafeAddress,
      gnosisPaySafeAddress: null,
      week,
      tokenBalanceSnapshotModel: (mockTokenBalanceSnapshotModel as unknown) as TargetModelType,
    });

    assertEquals(result, 0);
    restore();
  });

  await t.step('returns Metri snapshots when Gnosis Pay safe has no snapshots', async () => {
    const metriSnapshots: TokenBalanceSnapshotWithTokenFieldsType[] = [
      {
        _id: `43469306/${metriSafeAddress}/${gnoTokenAddress}`,
        week,
        address: metriSafeAddress,
        balance: 10.5,
        balanceRaw: '10500000000000000000',
        block: 43469306,
        token: mockGnoToken,
      },
      {
        _id: `43469400/${metriSafeAddress}/${gnoTokenAddress}`,
        week,
        address: metriSafeAddress,
        balance: 11.0,
        balanceRaw: '11000000000000000000',
        block: 43469400,
        token: mockGnoToken,
      },
    ];

    const findSpy = spy((query: { address: Address }) => {
      if (query.address === metriSafeAddress) {
        return createMockQuery(Promise.resolve(metriSnapshots));
      }
      // Gnosis Pay safe has no snapshots
      return createMockQuery(Promise.resolve([]));
    });

    mockTokenBalanceSnapshotModel = {
      find: findSpy,
    };

    const result = await findLowestMetriWalletGnoBalance({
      metriSafeAddress,
      gnosisPaySafeAddress,
      week,
      tokenBalanceSnapshotModel: (mockTokenBalanceSnapshotModel as unknown) as TargetModelType,
    });

    // Should return the minimum of Metri snapshots (10.5)
    assertEquals(result, 10.5);

    restore();
  });

  await t.step('returns 0 when Metri safe has no snapshots and Gnosis Pay safe has snapshots', async () => {
    const gnosisPaySnapshots: TokenBalanceSnapshotWithTokenFieldsType[] = [
      {
        _id: `43469306/${gnosisPaySafeAddress}/${gnoTokenAddress}`,
        week,
        address: gnosisPaySafeAddress,
        balance: 15.0,
        balanceRaw: '15000000000000000000',
        block: 43469306,
        token: mockGnoToken,
      },
    ];

    const findSpy = spy((query: { address: Address }) => {
      if (query.address === metriSafeAddress) {
        // Metri safe has no snapshots
        return createMockQuery(Promise.resolve([]));
      }
      return createMockQuery(Promise.resolve(gnosisPaySnapshots));
    });

    mockTokenBalanceSnapshotModel = {
      find: findSpy,
    };

    const result = await findLowestMetriWalletGnoBalance({
      metriSafeAddress,
      gnosisPaySafeAddress,
      week,
      tokenBalanceSnapshotModel: (mockTokenBalanceSnapshotModel as unknown) as TargetModelType,
    });

    // Should return 0 when Metri has no snapshots
    assertEquals(result, 0);

    restore();
  });

  await t.step(
    'takes maximum balance when both safes have snapshots at the same block (GNO moves from Pay to Metri)',
    async () => {
      const metriSnapshots: TokenBalanceSnapshotWithTokenFieldsType[] = [
        {
          _id: `43469306/${metriSafeAddress}/${gnoTokenAddress}`,
          week,
          address: metriSafeAddress,
          balance: 0, // GNO hasn't moved to Metri yet
          balanceRaw: '0',
          block: 43469306,
          token: mockGnoToken,
        },
        {
          _id: `43469400/${metriSafeAddress}/${gnoTokenAddress}`,
          week,
          address: metriSafeAddress,
          balance: 11.0, // GNO has moved to Metri
          balanceRaw: '11000000000000000000',
          block: 43469400,
          token: mockGnoToken,
        },
      ];

      const gnosisPaySnapshots: TokenBalanceSnapshotWithTokenFieldsType[] = [
        {
          _id: `43469306/${gnosisPaySafeAddress}/${gnoTokenAddress}`,
          week,
          address: gnosisPaySafeAddress,
          balance: 10.5, // GNO is still in Pay safe
          balanceRaw: '10500000000000000000',
          block: 43469306,
          token: mockGnoToken,
        },
        {
          _id: `43469400/${gnosisPaySafeAddress}/${gnoTokenAddress}`,
          week,
          address: gnosisPaySafeAddress,
          balance: 0, // GNO has moved to Metri
          balanceRaw: '0',
          block: 43469400,
          token: mockGnoToken,
        },
      ];

      const findSpy = spy((query: { address: Address }) => {
        if (query.address === metriSafeAddress) {
          return createMockQuery(Promise.resolve(metriSnapshots));
        }
        return createMockQuery(Promise.resolve(gnosisPaySnapshots));
      });

      mockTokenBalanceSnapshotModel = {
        find: findSpy,
      };

      const result = await findLowestMetriWalletGnoBalance({
        metriSafeAddress,
        gnosisPaySafeAddress,
        week,
        tokenBalanceSnapshotModel: (mockTokenBalanceSnapshotModel as unknown) as TargetModelType,
      });

      // Minimum balance should be 10.5
      assertEquals(result, 11);

      restore();
    },
  );

  await t.step(
    'handles zero balances correctly - do not use pay safe balance when metri has zero snapshots',
    async () => {
      const metriSnapshots: TokenBalanceSnapshotWithTokenFieldsType[] = [
        {
          _id: `43469306/${metriSafeAddress}/${gnoTokenAddress}`,
          week,
          address: metriSafeAddress,
          balance: 0, // GNO hasn't moved to Metri yet
          balanceRaw: '0',
          block: 43469306,
          token: mockGnoToken,
        },
      ];

      const gnosisPaySnapshots: TokenBalanceSnapshotWithTokenFieldsType[] = [
        {
          _id: `43469306/${gnosisPaySafeAddress}/${gnoTokenAddress}`,
          week,
          address: gnosisPaySafeAddress,
          balance: 5.0, // GNO is still in Pay safe
          balanceRaw: '5000000000000000000',
          block: 43469306,
          token: mockGnoToken,
        },
      ];

      const findSpy = spy((query: { address: Address }) => {
        if (query.address === metriSafeAddress) {
          return createMockQuery(Promise.resolve(metriSnapshots));
        }
        return createMockQuery(Promise.resolve(gnosisPaySnapshots));
      });

      mockTokenBalanceSnapshotModel = {
        find: findSpy,
      };

      const result = await findLowestMetriWalletGnoBalance({
        metriSafeAddress,
        gnosisPaySafeAddress,
        week,
        tokenBalanceSnapshotModel: (mockTokenBalanceSnapshotModel as unknown) as TargetModelType,
      });

      // Should return 0 (Metri has zero balance, don't use Pay safe balance)
      assertEquals(result, 0);

      restore();
    },
  );

  await t.step('custom setup for testing', async () => {
    const week = '2025-11-23' as WeekIdFormatType;
    const metriSafeAddress = '0xed1afb38731ce824d51e01ef733b0031b69fead9' as Address;
    const gnosisPaySafeAddress = '0x26d37e6e92002097e7306d2a02a80817d02f3707' as Address;

    const metriSnapshots: TokenBalanceSnapshotWithTokenFieldsType[] = [
      {
        _id: `43328072/${metriSafeAddress}/${gnoTokenAddress}`,
        week,
        address: metriSafeAddress,
        balanceRaw: '15400000000000000000',
        balance: 0.154,
        token: mockGnoToken,
        block: 43328072,
      },
      {
        _id: `43328264/${metriSafeAddress}/${gnoTokenAddress}`,
        week,
        address: metriSafeAddress,
        balanceRaw: '15400000000000000000',
        balance: 0.154,
        token: mockGnoToken,
        block: 43328264,
      },
      {
        _id: `43328269/${metriSafeAddress}/${gnoTokenAddress}`,
        week,
        address: metriSafeAddress,
        balanceRaw: '15400000000000000000',
        balance: 0.154,
        token: mockGnoToken,

        block: 43328269,
      },
      {
        _id: '43342966/${metriSafeAddress}/${gnoTokenAddress}',
        week,
        address: metriSafeAddress,
        balanceRaw: '11144000000000000000',
        balance: 11.144,
        token: mockGnoToken,
        block: 43342966,
      },
    ].sort((a, b) => a.block - b.block); // Sort by block number ascending (oldest first)
    const gnosisPaySnapshots: TokenBalanceSnapshotWithTokenFieldsType[] = [
      {
        _id: `43328294/${gnosisPaySafeAddress}/${gnoTokenAddress}`,
        week,
        address: gnosisPaySafeAddress,
        balanceRaw: '10990000000000000000',
        balance: 10.990,
        token: mockGnoToken,
        block: 43328294,
      },
      {
        _id: `43342966/${gnosisPaySafeAddress}/${gnoTokenAddress}`,
        week,
        address: gnosisPaySafeAddress,
        balanceRaw: '5000000000000000000',
        balance: 0.00005,
        token: mockGnoToken,
        block: 43342966,
      },
    ].sort((a, b) => a.block - b.block); // Sort by block number ascending (oldest first)

    const findSpy = spy((query: { address: Address }) => {
      if (query.address === metriSafeAddress) {
        return createMockQuery(Promise.resolve(metriSnapshots));
      }
      return createMockQuery(Promise.resolve(gnosisPaySnapshots));
    });

    mockTokenBalanceSnapshotModel = {
      find: findSpy,
    };

    const result = await findLowestMetriWalletGnoBalance({
      metriSafeAddress,
      gnosisPaySafeAddress,
      week,
      tokenBalanceSnapshotModel: (mockTokenBalanceSnapshotModel as unknown) as TargetModelType,
    });

    // Minimum balance should be 11.144
    assertEquals(result, 11.144);
  });
});
