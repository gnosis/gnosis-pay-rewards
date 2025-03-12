import { createRollupConfig } from '@karpatkey/rollup-config';
import packageJson from './package.json' with { type: 'json' };

const config = createRollupConfig(packageJson);

export default config;
