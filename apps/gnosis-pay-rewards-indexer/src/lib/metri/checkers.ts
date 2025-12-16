import axios from 'axios';
import { Address, getAddress } from 'viem';
import { retry } from '../retry.ts';

const ENVIO_API_URL = 'https://gnosis-e702590.dedicated.hyperindex.xyz/v1/graphql';

/**
 * Get the Gnosis Pay safe address that a Metri safe is an owner of.
 * @param metriSafeAddress - The Metri safe address
 * @returns Promise<Address | null> - The Gnosis Pay safe address, or null if not found
 */
export async function getGnosisPaySafeFromMetriSafe(
  metriSafeAddress: Address,
): Promise<Address | null> {
  const checksumAddress = getAddress(metriSafeAddress);

  try {
    const query = `
      query payOwners($address: String!) {
        Metri_Pay_DelayModule(where: {owners: {ownerAddress: {_eq: $address}}}) {
          safeAddress
          owners(where: {ownerAddress: {_eq: $address}}) {
            isOG
          }
        }
      }
    `;

    const response = await axios.post(
      ENVIO_API_URL,
      {
        query,
        variables: {
          address: checksumAddress,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const delayModules = response.data?.data?.Metri_Pay_DelayModule || [];

    if (delayModules.length === 0) {
      return null;
    }

    // Get the first safe address (a metri safe should only be an owner of one Gnosis Pay safe)
    const safeAddress = delayModules[0]?.safeAddress;

    if (!safeAddress) {
      return null;
    }

    return safeAddress.toLowerCase() as Address;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        `Error getting Gnosis Pay safe from Metri safe ${checksumAddress}:`,
        {
          message: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: ENVIO_API_URL,
          data: error.response?.data,
        },
        error,
      );
    } else {
      console.error(
        `Error getting Gnosis Pay safe from Metri safe ${checksumAddress}:`,
        error,
      );
    }
    return null;
  }
}

/**
 * Get the Gnosis Pay safe addresses for multiple Metri safe addresses.
 * Uses a single batched GraphQL query for efficiency.
 * @param metriSafeAddresses - Array of Metri safe addresses
 * @returns Promise<Map<Address, Address | null>> - Map of Metri safe address to Gnosis Pay safe address (or null if not found)
 */
export async function getGnosisPaySafesFromMetriSafes(
  metriSafeAddresses: Address[],
): Promise<
  {
    resultsArray: Array<{
      metriAddressChecksum: Address;
      metriAddress: Address;
      gnosisPaySafeAddress: Address | null;
    }>;
    resultsMap: Map<Address, Address | null>;
  }
> {
  // The GraphQL query expects addresses in checksum format
  const checksumAddresses = metriSafeAddresses.map((addr) => getAddress(addr));
  // Convert all addresses to lowercase for cache key generation
  const normalizedAddresses = metriSafeAddresses.map((addr) => addr.toLowerCase() as Address);
  const resultsArray: Array<{
    metriAddressChecksum: Address;
    metriAddress: Address;
    gnosisPaySafeAddress: Address | null;
  }> = [];
  const resultsMap: Map<Address, Address | null> = new Map();

  // If no addresses provided, return empty map
  if (normalizedAddresses.length === 0) {
    return {
      resultsArray,
      resultsMap,
    };
  }

  // Initialize result map with null values
  for (const addr of normalizedAddresses) {
    resultsMap.set(addr, null);
  }

  try {
    const query = `
      query payOwnersMultiple($addresses: [String!]!) {
        Metri_Pay_DelayModule(where: {owners: {ownerAddress: {_in: $addresses}}}) {
          gnosisPayAddress: safeAddress
          owners(where: {ownerAddress: {_in: $addresses}}) {
            metriAddress: ownerAddress
            isOG
          }
        }
      }
    `;

    const response = await axios.post<{
      data: {
        Metri_Pay_DelayModule: {
          gnosisPayAddress: Address;
          owners: {
            metriAddress: Address;
            isOG: boolean;
          }[];
        }[];
      };
    }>(
      ENVIO_API_URL,
      {
        query,
        variables: {
          addresses: checksumAddresses,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const delayModules = response.data?.data?.Metri_Pay_DelayModule || [];

    // Process each delay module and map owners to their safe addresses
    for (const module of delayModules) {
      const gnosisPayAddressLowercase = module?.gnosisPayAddress.toLowerCase() as Address;
      for (const { metriAddress } of module?.owners || []) {
        const metriAddressLowercase = metriAddress.toLowerCase() as Address;
        resultsArray.push({
          metriAddressChecksum: getAddress(metriAddress),
          metriAddress: metriAddressLowercase,
          gnosisPaySafeAddress: gnosisPayAddressLowercase,
        });
        resultsMap.set(metriAddressLowercase, gnosisPayAddressLowercase);
      }
    }

    return {
      resultsArray,
      resultsMap,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        `Error getting Gnosis Pay safes from Metri safes:`,
        {
          message: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: ENVIO_API_URL,
          data: error.response?.data,
          addresses: checksumAddresses,
        },
        error,
      );
    } else {
      console.error(
        `Error getting Gnosis Pay safes from Metri safes:`,
        error,
      );
    }
    // Return map with all null values on error
    return {
      resultsArray,
      resultsMap,
    };
  }
}

/**
 * Check if a Gnosis Pay wallet is a Metri safe.
 * A Metri safe is identified by checking if the Safe address is a registered Circles human.
 * This is done by querying the Envio API to check if the address has an Avatar with
 * avatarType of "RegisterHuman" or "Unknown" (registered or pending registration).
 *
 * @param safeAddress - The Gnosis Pay safe address to check
 * @returns Promise<boolean> - True if the wallet is a Metri safe, false otherwise
 */
export async function isMetriSafe(address: Address): Promise<boolean> {
  // use checksum address
  const checksumAddress = getAddress(address);

  try {
    // Query Envio to check if the Safe address is a registered Circles human
    const query = `
      query CheckMetriSafe($address: String!) {
        Avatar(where: {id: {_eq: $address } }) {
          id
          avatarType
          profile {
            name
          }
        }
      }
    `;

    // Add timeout and retry logic for the HTTP request
    // This handles network issues, timeouts, and canceled operations gracefully
    const response = await retry(
      async () => {
        return await axios.post(
          ENVIO_API_URL,
          {
            query,
            variables: {
              address: checksumAddress,
            },
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
            timeout: 10000, // 10 second timeout
          },
        );
      },
      {
        retries: 3,
        minTimeout: 500, // Start with 500ms
        maxTimeout: 2000, // Max 2 seconds between retries
        onRetry: (error, attempt) => {
          // Only log retries for non-cancellation errors
          if (!error.message.includes('canceled') && !error.message.includes('operation was canceled')) {
            console.warn(
              `Retrying Metri safe check for ${checksumAddress} (attempt ${attempt}):`,
              error.message,
            );
          }
        },
      },
    );

    const avatars = response.data?.data?.Avatar || [];

    if (avatars.length === 0) {
      return false;
    }

    // Check if any avatar has avatarType of "RegisterHuman" or "Unknown"
    // These indicate registered or pending registration as a Circles human
    const avatar = avatars[0];
    const avatarType = avatar.avatarType;

    return avatarType === 'RegisterHuman' || avatarType === 'Unknown';
  } catch (error) {
    // Handle cancellation errors silently (they're usually due to process termination)
    const isCanceled = error instanceof Error && (
      error.message.includes('canceled') ||
      error.message.includes('operation was canceled') ||
      (axios.isAxiosError(error) && error.code === 'ECONNABORTED')
    );

    if (isCanceled) {
      // Return false for canceled operations (process might be shutting down)
      return false;
    }

    if (axios.isAxiosError(error)) {
      console.error(
        `Error checking if safe ${checksumAddress} is a Metri safe:`,
        {
          message: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: ENVIO_API_URL,
          data: error.response?.data,
        },
        error,
      );
    } else {
      console.error(
        `Error checking if safe ${checksumAddress} is a Metri safe:`,
        error,
      );
    }
    // Return false on error to be safe
    return false;
  }
}
