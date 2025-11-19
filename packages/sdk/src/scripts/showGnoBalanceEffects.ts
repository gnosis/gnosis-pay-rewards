import { getMaxWeeklySpending, calculateRewardAmountPercentageTier } from '../calculateWeekRewardAmount.js';

/**
 * Generate a range of GNO balance values to test
 */
function generateGnoBalancePoints(): number[] {
  const points: number[] = [];

  // Below threshold
  points.push(0.05);

  // Tier 1: 0.1 - 1 GNO
  points.push(0.1);
  points.push(0.2);
  points.push(0.3);
  points.push(0.5);
  points.push(0.7);
  points.push(1.0);

  // Tier 2: 1 - 10 GNO
  points.push(2);
  points.push(3);
  points.push(5);
  points.push(7);
  points.push(10);

  // Tier 3: 10 - 100 GNO
  points.push(20);
  points.push(30);
  points.push(50);
  points.push(70);
  points.push(100);

  // Tier 4: 100+ GNO
  points.push(150);
  points.push(200);
  points.push(500);

  return points;
}

/**
 * Format number to 2 decimal places
 */
function formatNumber(num: number): string {
  return num.toFixed(2);
}

/**
 * Format currency to 2 decimal places with $ prefix
 */
function formatCurrency(num: number): string {
  return `$${num.toFixed(2)}`;
}

/**
 * Main function to generate and display the table
 */
function main() {
  const gnoBalances = generateGnoBalancePoints();

  const tableData = gnoBalances.map((gnoBalance) => {
    const weeklyCap = getMaxWeeklySpending(gnoBalance);
    const rewardTierNoOg = calculateRewardAmountPercentageTier(gnoBalance, false);
    const rewardTierWithOg = calculateRewardAmountPercentageTier(gnoBalance, true);

    return {
      'GNO Balance': formatNumber(gnoBalance),
      'Weekly Cap (USD)': formatCurrency(weeklyCap),
      'Reward % (No OG)': `${formatNumber(rewardTierNoOg)}%`,
      'Reward % (With OG)': `${formatNumber(rewardTierWithOg)}%`,
    };
  });

  console.log('\n📊 GNO Balance Effects on Weekly Caps and Reward Percentages\n');
  console.table(tableData);
  console.log('\n💡 Note: Values use linear interpolation between tier boundaries');
  console.log('   Tier 1: 0.1-1 GNO → $250-$375 cap, 1%-2% reward');
  console.log('   Tier 2: 1-10 GNO → $375-$500 cap, 2%-3% reward');
  console.log('   Tier 3: 10-100 GNO → $500-$1,250 cap, 3%-4% reward');
  console.log('   Tier 4: 100+ GNO → $1,250 cap, 4% reward');
  console.log('   OG NFT holders get +1% reward boost\n');
}

main();
