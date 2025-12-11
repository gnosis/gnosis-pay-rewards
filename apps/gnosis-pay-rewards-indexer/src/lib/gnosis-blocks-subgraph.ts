import axios from 'axios';
import { RateLimitError } from '../process/errors.ts';

export type SubgraphBlockType = {
  timestamp: number;
  hash: string;
  number: number;
};

const SUBGRAPH_URL = 'https://gateway.thegraph.com/api/subgraphs/id/FxV6YUix58SpYmLBwc9gEHkwjfkqwe1X5FJQjn8nKPyA';

export async function getBlocksInfo(apiKey: string, blockNumbers: number[]): Promise<SubgraphBlockType[]> {
  try {
    // Convert number array to string array for GraphQL query
    const blockNumbersString = blockNumbers.map((n) => n.toString()).join(',');

    const response = await axios.post(
      SUBGRAPH_URL,
      {
        query: `
          query {
            blocks(where: {number_in: [${blockNumbersString}]}) {
              timestamp
              id
              number
            }
          }
        `,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    if (response.data.errors) {
      const errorMessage = response.data.errors[0].message;
      // Check if it's a rate-limit error
      if (
        errorMessage.toLowerCase().includes('payment required') ||
        errorMessage.toLowerCase().includes('rate limit') ||
        errorMessage.toLowerCase().includes('quota')
      ) {
        throw new RateLimitError(`Error getting block info from subgraph: ${errorMessage}`);
      }
      throw new Error(`Error getting block info from subgraph: ${errorMessage}`);
    }

    // Transform the response to the BlockBaseType[]
    const blockInfo: SubgraphBlockType[] = response.data.data.blocks.map((block: any) => ({
      hash: block.id,
      timestamp: Number(block.timestamp),
      number: Number(block.number),
    }));

    return blockInfo;
  } catch (error) {
    if (error instanceof RateLimitError) {
      throw error;
    }

    if (axios.isAxiosError(error)) {
      // Check for HTTP 429 (Too Many Requests) or other rate-limit status codes
      if (error.response?.status === 429) {
        throw new RateLimitError(`Rate limit error from subgraph: ${error.response?.statusText || error.message}`);
      }

      // Check error message for rate-limit indicators
      const errorMessage = error.message.toLowerCase();
      const responseData = error.response?.data;
      const responseDataString = typeof responseData === 'string'
        ? responseData.toLowerCase()
        : JSON.stringify(responseData || '').toLowerCase();

      if (
        errorMessage.includes('payment required') ||
        errorMessage.includes('rate limit') ||
        errorMessage.includes('quota') ||
        responseDataString.includes('payment required') ||
        responseDataString.includes('rate limit') ||
        responseDataString.includes('quota')
      ) {
        throw new RateLimitError(`Rate limit error from subgraph: ${error.response?.statusText || error.message}`);
      }

      console.error('Error fetching data:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      });
    } else {
      console.error('Error fetching data:', error);
    }
    throw error;
  }
}
