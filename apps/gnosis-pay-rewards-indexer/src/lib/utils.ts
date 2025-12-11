/**
 * Chunks an array into smaller arrays of a given size.
 * @param array - The array to chunk.
 * @param chunkSize - The size of each chunk.
 * @returns An array of arrays, where each sub-array is a chunk of the original array.
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const result = array.reduce((resultArray, item, index) => {
    const chunkIndex = Math.floor(index / chunkSize);

    if (!resultArray[chunkIndex]) {
      resultArray[chunkIndex] = []; // start a new chunk
    }

    resultArray[chunkIndex].push(item);

    return resultArray;
  }, [] as T[][]);

  return result;
}
