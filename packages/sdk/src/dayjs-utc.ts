import dayjsCore from 'dayjs';
import dayjsUtcPlugin from 'dayjs/plugin/utc.js';
import updateLocalePlugin from 'dayjs/plugin/updateLocale.js';

dayjsCore.extend(dayjsUtcPlugin);
dayjsCore.extend(updateLocalePlugin);

export const dayjsUtc = dayjsCore;
