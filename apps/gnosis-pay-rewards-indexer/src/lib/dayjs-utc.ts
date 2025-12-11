import dayjsCore from 'dayjs';
import dayjsUtcPlugin from 'dayjs/plugin/utc.js';

/**
 * Extend dayjs with the utc plugin
 */
dayjsCore.extend(dayjsUtcPlugin);

export const dayjsUtc = dayjsCore;
