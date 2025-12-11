import { createRollupConfig } from '@kpk/rollup-config';
import packageJson from './package.json' with { type: 'json' };

const config = createRollupConfig(packageJson);

export default config;
