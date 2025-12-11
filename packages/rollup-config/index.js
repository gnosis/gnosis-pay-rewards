import dts from 'rollup-plugin-dts';
import { commonBuildConfig, createExportConfig } from './config.js';

/**
 * @param {Record<'exports', unknown>} packageJson
 * @returns {import('rollup').RollupOptions[]}
 */
export function createRollupConfig(packageJson, createTypes = true) {
  return Object.keys(packageJson.exports)
    .filter((moduleName) => {
      const module = packageJson.exports[moduleName];
      return moduleName !== './package.json' && module.import && module.require && module.types && module.source;
    })
    .map((moduleName) => {
      const module = packageJson.exports[moduleName];
      return createExportModule(moduleName, module, createTypes);
    })
    .flat();
}

/**
 * @param {string} exportName - The name of the export
 * @param {Record<'source' | 'require' | 'types' | 'import' | 'node', string>} exportModuleDefinition - The path to the entry file
 * @returns
 */
export function createExportModule(exportName, exportModuleDefinition, createTypes = true) {
  // Require all the properties
  if (
    !exportModuleDefinition.source ||
    !exportModuleDefinition.require ||
    !exportModuleDefinition.types ||
    !exportModuleDefinition.import ||
    !exportModuleDefinition.node
  ) {
    throw new Error(
      `Invalid export definition for ${exportName}. Must contain source, require, types, import, and node`,
    );
  }

  // The source path
  const input = exportModuleDefinition.source;
  // Check if the path is valid
  if (!input.startsWith('./src')) {
    throw new Error(`Export source path for ${exportName} is not valid. Must be a relative path to the src folder`);
  }

  const outputs = [
    {
      input,
      output: [
        {
          ...commonBuildConfig,
          file: exportModuleDefinition.require,
          format: 'cjs',
        },
        {
          ...commonBuildConfig,
          file: exportModuleDefinition.import,
          format: 'esm',
        },
      ],
      ...createExportConfig(),
    },
  ];

  if (createTypes === true) {
    outputs.push({
      input,
      output: {
        file: exportModuleDefinition.types,
      },
      plugins: [dts()],
    });
  }

  return outputs;
}
