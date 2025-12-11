# @kpk/rollup-config

This is a library that provides a Rollup config for Karpatkey, a tool that
allows for swift creation of a Rollup config for your library.

## Usage

```javascript
// ./rollup.config.js
import { createRollupConfig } from '@kpk/rollup-config';
import packageJson from './package.json' assert { type: 'json' };

const config = createRollupConfig(packageJson);

export default config;
```
