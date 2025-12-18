# Rewards API Routes

Base URL: `http://<vm-address>:3002`

**Note:** All routes use GET method unless specified otherwise. No authentication required.

---

## Root Routes (`/`)

### `GET /`
- **Description:** Health check endpoint
- **Parameters:** None
- **Response:** Empty data object with status 200

### `GET /status`
- **Description:** Get indexer states/status
- **Parameters:** None
- **Response:** Indexer state information

### `GET /info`
- **Description:** Get API info (block info provider cache size)
- **Parameters:** None
- **Response:** Info about block info provider

### `GET /week-snapshots`
- **Description:** Get all week snapshots for a specific week
- **Required Parameters:**
  - `week` (string): Week ID (e.g., "2025-W46")
- **Response:** Array of week snapshots with safe, transactions, and token balances

### `GET /weeks`
- **Description:** Get list of all available weeks
- **Parameters:** None
- **Response:** Array of week objects sorted by most recent first

### `GET /summary`
- **Description:** Get rewards summary for a Gnosis Pay Safe
- **Required Parameters:**
  - `safe` (address): Safe address
- **Optional Parameters:**
  - `week` (string): Week ID (defaults to current week)
- **Response:** Summary with pending rewards, earned rewards, and safe info

### `GET /distributions`
- **Description:** Get reward distribution transactions
- **Optional Parameters:**
  - `limit` (number): Results per page (default: 100)
  - `page` (number): Page number (default: 1)
  - `address` (address): Filter by address
  - `week` (string): Filter by week ID
  - `from-address` (address): Filter by sender address
  - `to-address` (address): Filter by recipient address
  - `token` (address): Filter by token address
- **Response:** Paginated list of reward transactions

### `GET /token-prices`
- **Description:** Get token price snapshots
- **Optional Parameters:**
  - `limit` (number): Results per page (default: 100)
  - `page` (number): Page number (default: 1)
  - `date` (string): Filter by date (format: YYYY-MM-DD)
- **Response:** Paginated list of token prices

### `GET /blocks`
- **Description:** Get processed blocks
- **Optional Parameters:**
  - `limit` (number): Results per page (default: 100)
  - `page` (number): Page number (default: 1)
- **Response:** Paginated list of blocks (sorted by block number descending)

### `GET /processed-blocks`
- **Description:** Get processed blocks information
- **Optional Parameters:**
  - `limit` (number): Results per page (default: 100)
  - `page` (number): Page number (default: 1)
- **Response:** Paginated list of processed blocks (sorted by block number descending)

### `GET /tokens`
- **Description:** Get all tokens
- **Parameters:** None
- **Response:** Array of all token information

### `GET /token-balance-snapshots`
- **Description:** Get token balance snapshots for an address
- **Optional Parameters:**
  - `limit` (number): Results per page (default: 100)
  - `page` (number): Page number (default: 1)
  - `address` (address): Safe address (required if week/block not provided)
  - `week` (string): Week ID
  - `block` (number): Block number
  - `token` (address): Filter by token address
- **Response:** Token balance snapshots
- **Note:** Address must be a Gnosis Pay Safe or Metri Safe

### `GET /token-balances-at-block`
- **Description:** Get token balances at a specific block
- **Optional Parameters:**
  - `limit` (number): Results per page (default: 100)
  - `page` (number): Page number (default: 1)
  - `block` (number): Block number
  - `address` (address): Safe address
  - `token` (address): Filter by token address
- **Response:** Token balances at the specified block

---

## Metri Routes (`/metri`)

### `GET /metri/rewards`
- **Description:** Get Metri Safe week rewards snapshot
- **Required Parameters:**
  - `safe` (address): Metri Safe address
- **Optional Parameters:**
  - `week` (string): Week ID (defaults to current week)
- **Response:** Metri Safe rewards data including token balances and transactions

### `GET /metri/week-balances`
- **Description:** Get minimum token balances for all Metri Safes for a week
- **Required Parameters:**
  - `week` (string): Week ID
- **Response:** Array of Metri Safes with their minimum token balances

### `GET /metri/week-balances/by-addresses`
- **Description:** Get minimum token balances for specific Metri Safes by addresses
- **Required Parameters:**
  - `addresses` (string|array): Comma-separated addresses or array of addresses
  - `week` (string): Week ID
- **Response:** Array of Metri Safes with minimum and maximum token balances
- **Example:** `?addresses=0x123...,0x456...&week=2025-W46`

### `POST /metri/week-rewards-data-summary`
- **Description:** Get week rewards data summary for multiple Metri Safes
- **Method:** POST
- **Body Parameters:**
  - `addresses` (array): Array of Metri Safe addresses (required)
  - `week` (string): Week ID (optional, defaults to current week)
- **Response:** Week rewards data summary for the specified addresses

### `GET /metri/safes`
- **Description:** Get paginated list of Metri Safes
- **Optional Parameters:**
  - `limit` (number): Results per page (default: 100)
  - `page` (number): Page number (default: 1)
- **Response:** Paginated list of Metri Safes with their associated Gnosis Pay Safes

### `POST /metri/pay-safes`
- **Description:** Get Gnosis Pay Safe addresses associated with Metri Safe addresses
- **Method:** POST
- **Body Parameters:**
  - `addresses` (array): Array of Metri Safe addresses (required)
- **Response:** Mapping of Metri Safe addresses to their associated Gnosis Pay Safe addresses

---

## Pay Routes (`/pay`)

### `GET /pay/rewards`
- **Description:** Get Gnosis Pay Safe week rewards snapshot
- **Required Parameters:**
  - `safe` (address): Gnosis Pay Safe address
- **Optional Parameters:**
  - `week` (string): Week ID (defaults to current week)
- **Response:** Gnosis Pay Safe rewards data including token balances and transactions

### `GET /pay/rewards-summary`
- **Description:** Get rewards distribution summary
- **Optional Parameters:**
  - `safe` (address): Filter by safe address
  - `week` (string): Filter by week ID
- **Response:** Summary with weekly totals, total GNO paid out, and total distributions

### `GET /pay/transactions`
- **Description:** Get Gnosis Pay transactions
- **Optional Parameters:**
  - `limit` (number): Results per page (default: 100)
  - `page` (number): Page number (default: 1)
  - `safe` (address): Filter by safe address
  - `week` (string): Filter by week ID
  - `sort-by` (string): Sort field - "block", "amount", or "valueUSD" (default: "block")
  - `sort-order` (string): Sort order - "asc" or "desc" (default: "desc")
- **Response:** Paginated list of Gnosis Pay transactions

### `GET /pay/safes`
- **Description:** Get paginated list of Gnosis Pay Safes
- **Optional Parameters:**
  - `limit` (number): Results per page (default: 100)
  - `page` (number): Page number (default: 1)
- **Response:** Paginated list of Gnosis Pay Safes

---

## Notes

- **Address Format:** All addresses should be valid Ethereum addresses (0x...)
- **Week Format:** Week IDs follow the format `YYYY-W##` (e.g., "2025-W46")
- **Pagination:** Most endpoints support pagination with `limit` and `page` parameters
- **Caching:** Responses are cached (30 minutes for current week, 24 hours for older weeks)
- **CORS:** All endpoints allow CORS from any origin
- **Error Responses:** All errors follow a consistent format with error code and message
