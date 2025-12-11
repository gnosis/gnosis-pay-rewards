import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import {
  calculateMetriCrcPerEur,
  calculateMetriWeekRewardAmount,
  getMetriMaxWeeklySpending,
  getMetriWeeklyCrcCap,
} from '../rewards/metri-rewards.js';

/**
 * Generate a range of GNO balance values to test
 * Includes points to demonstrate the continuous scale interpolation
 */
function generateGnoBalancePoints(): number[] {
  const points: number[] = [];

  // Tier 1: 0 GNO (discrete)
  points.push(0);

  // Tier 2: 0.1-1 GNO (continuous scale starts)
  points.push(0.1); // Start of continuous scale
  points.push(0.2);
  points.push(0.55); // Midpoint to show interpolation
  points.push(0.9);

  // Tier 3: 1-10 GNO (continuous scale)
  points.push(1);
  points.push(2);
  points.push(5.5); // Midpoint to show interpolation
  points.push(9);

  // Tier 4: ≥10 GNO (continuous scale capped)
  points.push(10); // Continuous scale capped
  points.push(20);
  points.push(50);
  points.push(100);

  return points;
}

/**
 * Format number to 2 decimal places
 */
function formatNumber(num: number): string {
  return num.toFixed(2);
}

/**
 * Format currency to 2 decimal places with EUR suffix
 */
function formatCurrency(num: number): string {
  return `${num.toFixed(2)} EUR`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Generate HTML table from data
 */
function generateHtmlTable(data: Array<Record<string, string>>, weekVolumeEUR: number): string {
  const headers = Object.keys(data[0] || {});

  const headerRow = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('\n            ');
  const dataRows = data
    .map((row) => {
      const cells = headers.map((header) => `<td>${escapeHtml(row[header] || '')}</td>`).join('\n          ');
      return `        <tr>\n          ${cells}\n        </tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Metri Rewards: GNO Balance Effects</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css">
  <style>
    :root {
      --bg-primary: #000000;
      --bg-secondary: #000000;
      --bg-gradient-start: #000000;
      --bg-gradient-end: #000000;
      --text-primary: #ffffff;
      --text-secondary: #ffffff;
      --border-color: #333333;
      --card-bg: #000000;
      --card-border: #333333;
      --header-bg: linear-gradient(to right, #000000, #000000);
      --table-header-bg: #1a1a1a;
      --table-row-hover: #1a1a1a;
      --info-bg: #1a1a1a;
      --info-border: #ffffff;
      --info-text: #ffffff;
      --info-text-light: #ffffff;
      --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.5), 0 1px 2px 0 rgba(0, 0, 0, 0.3);
      --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -2px rgba(0, 0, 0, 0.3);
    }

    * {
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, var(--bg-gradient-start) 0%, var(--bg-gradient-end) 100%);
      color: var(--text-primary);
      min-height: 100vh;
      padding: 1rem;
      transition: background-color 0.3s ease, color 0.3s ease;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      box-shadow: var(--shadow);
      margin-bottom: 1.5rem;
      overflow: hidden;
      transition: background-color 0.3s ease, border-color 0.3s ease;
    }

    .header-card {
      background: var(--header-bg);
      color: white;
      padding: 2rem;
      text-align: center;
    }

    .header-card h1 {
      font-size: 1.875rem;
      font-weight: 700;
      margin: 0 0 0.5rem 0;
    }

    .header-card p {
      font-size: 1.125rem;
      color: rgba(255, 255, 255, 0.9);
      margin: 0;
    }

    @media (min-width: 768px) {
      .header-card {
        padding: 2rem 3rem;
      }
      .header-card h1 {
        font-size: 2.25rem;
      }
    }

    .table-container {
      padding: 1rem;
      overflow-x: auto;
    }

    @media (min-width: 768px) {
      .table-container {
        padding: 1.5rem;
      }
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
      border: 1px solid var(--border-color);
      border-radius: 0.375rem;
      overflow: hidden;
    }

    thead {
      background: var(--table-header-bg);
    }

    th {
      padding: 0.75rem 1rem;
      text-align: left;
      font-weight: 600;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border-color);
    }

    tbody tr {
      border-bottom: 1px solid var(--border-color);
      transition: background-color 0.2s ease;
    }

    tbody tr:last-child {
      border-bottom: none;
    }

    tbody tr:hover {
      background: var(--table-row-hover);
    }

    td {
      padding: 1rem;
      color: var(--text-primary);
    }

    .info-card {
      padding: 1.5rem;
    }

    .info-box {
      background: var(--info-bg);
      border-left: 4px solid var(--info-border);
      border-radius: 0.375rem;
      padding: 1.5rem;
    }

    @media (min-width: 768px) {
      .info-box {
        padding: 2rem;
      }
    }

    .info-box h3 {
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--info-text);
      margin: 0 0 1rem 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .info-box ul {
      list-style: none;
      padding: 0;
      margin: 0 0 1rem 0;
    }

    .info-box li {
      padding: 0.5rem 0;
      color: var(--info-text-light);
      font-size: 0.875rem;
      line-height: 1.6;
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
    }

    .info-box li strong {
      color: var(--info-text);
      font-weight: 600;
    }

    .info-box p {
      margin: 1rem 0 0 0;
      font-size: 0.875rem;
      color: var(--info-text-light);
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header Card -->
    <div class="card">
      <div class="header-card">
        <h1>Metri Rewards: GNO Balance Effects on CRC Rewards</h1>
        <p>Example Weekly Spending: ${formatCurrency(weekVolumeEUR)}</p>
      </div>
    </div>

    <!-- Table Card -->
    <div class="card">
      <div class="table-container">
        <table>
          <thead>
            <tr>
              ${headerRow}
            </tr>
          </thead>
          <tbody>
            ${dataRows}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Info Card -->
    <div class="card">
      <div class="info-card">
        <div class="info-box">
          <h3>
            Metri Rewards Structure (Continuous Scale)
          </h3>
          <ul>
            <li>
              <strong>Tier 1:</strong>
              <span>0 GNO → 1 CRC/EUR, 1000 CRC weekly cap, 1000 EUR max weekly spending (discrete)</span>
            </li>
            <li>
              <strong>Tier 2:</strong>
              <span>0.1-1 GNO → Continuous scale from 2 to 3 CRC/EUR, 2000 to 3000 CRC cap, 1000 EUR max weekly spending</span>
            </li>
            <li>
              <strong>Tier 3:</strong>
              <span>1-10 GNO → Continuous scale from 3 to 4 CRC/EUR, 3000 to 4000 CRC cap, 1000 EUR max weekly spending</span>
            </li>
            <li>
              <strong>Tier 4:</strong>
              <span>≥10 GNO → 4 CRC/EUR, 4000 CRC weekly cap, 1000 EUR max weekly spending (continuous scale capped)</span>
            </li>
            <li>
              <strong>Gnosis NFT holders</strong>
              <span>get +1 CRC per EUR boost (applied to CRC/EUR rate)</span>
            </li>
          </ul>
          <p>
            The continuous scale uses linear interpolation between tier boundaries. Max weekly spending is 1000 EUR for all tiers.
          </p>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Main function to generate and display the table
 */
function main() {
  const gnoBalances = generateGnoBalancePoints();
  const weekVolumeEUR = 1_000; // Example weekly spending (in EUR)

  const tableData = gnoBalances.map((gnoBalance) => {
    const maxWeeklySpending = getMetriMaxWeeklySpending(gnoBalance);
    const crcPerEurNoNft = calculateMetriCrcPerEur(gnoBalance, false);
    const crcPerEurWithNft = calculateMetriCrcPerEur(gnoBalance, true);
    const weeklyCrcCapNoNft = getMetriWeeklyCrcCap(gnoBalance, false);
    const weeklyCrcCapWithNft = getMetriWeeklyCrcCap(gnoBalance, true);

    // Calculate rewards for both scenarios
    const rewardNoNft = calculateMetriWeekRewardAmount({
      weekVolumeEUR,
      gnoBalance,
      isOgNftHolder: false,
    });

    const rewardWithNft = calculateMetriWeekRewardAmount({
      weekVolumeEUR,
      gnoBalance,
      isOgNftHolder: true,
    });

    return {
      'GNO Balance': formatNumber(gnoBalance),
      'Max Weekly Spending (EUR)': formatCurrency(maxWeeklySpending),
      'CRC/EUR (No NFT)': formatNumber(crcPerEurNoNft),
      'CRC/EUR (With NFT)': formatNumber(crcPerEurWithNft),
      'Weekly Cap CRC (No NFT)': formatNumber(weeklyCrcCapNoNft),
      'Weekly Cap CRC (With NFT)': formatNumber(weeklyCrcCapWithNft),
      'Reward CRC (No NFT)': formatNumber(rewardNoNft.rewardAmountCrc),
      'Reward CRC (With NFT)': formatNumber(rewardWithNft.rewardAmountCrc),
    };
  });

  // Generate HTML
  const html = generateHtmlTable(tableData, weekVolumeEUR);

  // Write to file
  const outputPath = join(process.cwd(), 'metri-rewards-table.html');
  writeFileSync(outputPath, html, 'utf-8');

  console.log(`\n✅ HTML table generated: ${outputPath}\n`);

  // Open in default browser
  try {
    const platform = process.platform;
    let command: string;

    if (platform === 'darwin') {
      command = 'open';
    } else if (platform === 'win32') {
      command = 'start';
    } else {
      command = 'xdg-open';
    }

    execSync(`${command} "${outputPath}"`);
    console.log('🌐 Opened in default browser\n');
  } catch (error) {
    console.error('⚠️  Could not open browser automatically. Please open the file manually:', outputPath);
    console.error(error);
  }

  // Also log to console for reference
  console.log('\n📊 Metri Rewards: GNO Balance Effects on CRC Rewards\n');
  console.log(`💰 Example Weekly Spending: ${formatCurrency(weekVolumeEUR)}\n`);
  console.table(tableData);
  console.log('\n💡 Metri Rewards Structure (Continuous Scale):');
  console.log('   Tier 1: 0 GNO → 1 CRC/EUR, 1000 CRC weekly cap (discrete)');
  console.log('   Tier 2: 0.1-1 GNO → Continuous scale from 2 to 3 CRC/EUR, 2000 to 3000 CRC cap');
  console.log('   Tier 3: 1-10 GNO → Continuous scale from 3 to 4 CRC/EUR, 3000 to 4000 CRC cap');
  console.log('   Tier 4: ≥10 GNO → 4 CRC/EUR, 4000 CRC weekly cap (continuous scale capped)');
  console.log('   Gnosis NFT holders get +1 CRC per EUR boost (applied to CRC/EUR rate)');
  console.log('\n   📈 The continuous scale uses linear interpolation between tier boundaries.\n');
}

main();
