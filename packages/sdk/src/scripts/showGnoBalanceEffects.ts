import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { calculateRewardAmountPercentageTier, getMaxWeeklySpending } from '../calculateWeekRewardAmount.js';

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
function generateHtmlTable(data: Array<Record<string, string>>): string {
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
  <title>GNO Balance Effects on Weekly Caps and Reward Percentages</title>
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
        <h1>GNO Balance Effects on Weekly Caps and Reward Percentages</h1>
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
          <h3>Note: Values use linear interpolation between tier boundaries</h3>
          <ul>
            <li><strong>Tier 1:</strong> 0.1-1 GNO → $250-$375 cap, 1%-2% reward</li>
            <li><strong>Tier 2:</strong> 1-10 GNO → $375-$500 cap, 2%-3% reward</li>
            <li><strong>Tier 3:</strong> 10-100 GNO → $500-$1,250 cap, 3%-4% reward</li>
            <li><strong>Tier 4:</strong> 100+ GNO → $1,250 cap, 4% reward</li>
            <li><strong>OG NFT holders</strong> get +1% reward boost</li>
          </ul>
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

  // Generate HTML
  const html = generateHtmlTable(tableData);

  // Write to file
  const outputPath = join(process.cwd(), 'gno-balance-effects-table.html');
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
  console.log('\nGNO Balance Effects on Weekly Caps and Reward Percentages\n');
  console.table(tableData);
  console.log('\nNote: Values use linear interpolation between tier boundaries');
  console.log('   Tier 1: 0.1-1 GNO → $250-$375 cap, 1%-2% reward');
  console.log('   Tier 2: 1-10 GNO → $375-$500 cap, 2%-3% reward');
  console.log('   Tier 3: 10-100 GNO → $500-$1,250 cap, 3%-4% reward');
  console.log('   Tier 4: 100+ GNO → $1,250 cap, 4% reward');
  console.log('   OG NFT holders get +1% reward boost\n');
}

main();
