import commonjs from '@rollup/plugin-commonjs';
import image from '@rollup/plugin-image';
import jsonResolve from '@rollup/plugin-json';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import svgr from '@svgr/rollup';
import excludeDependenciesFromBundle from 'rollup-plugin-exclude-dependencies-from-bundle';
import css from 'rollup-plugin-import-css';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';

export const commonBuildConfig = {
  sourcemap: true,
  inlineDynamicImports: true,
};

const DEFAULT_EXTERNAL = [
  'react',
  'react-dom',
  'styled-components',
  'zustand',
  'axios',
  'ethers',
  'wagmi',
  '@rainbow-me/rainbowkit',
  'yup',
  'validator',
  'dayjs',
];

export const sharedLibConfig = {
  plugins: [
    excludeDependenciesFromBundle(),
    peerDepsExternal(),
    typescript({
      tsconfig: './tsconfig.json',
      compilerOptions: {},
    }),
    nodeResolve({
      browser: true,
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mts', '.mjs', '.json'],
    }),
    commonjs({
      esmExternals: true,
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
    }),
    css(),
    svgr({
      exportType: 'named',
      namedExport: 'ReactComponent',
      svgoConfig: {
        plugins: [
          {
            name: 'removeViewBox',
            active: false,
          },
        ],
      },
    }),
    image(),
    jsonResolve(),
  ],
};

/**
 * @param {*} external
 * @returns
 */
export function createExportConfig(external = DEFAULT_EXTERNAL) {
  return {
    ...sharedLibConfig,
    external,
  };
}
