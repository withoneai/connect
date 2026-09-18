import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';

const tsInclude = ['src/**/*.ts', 'src/**/*.tsx'];

/** Declarations land beside the bundles (dist/index.d.ts, dist/server/index.d.ts):
 *  the build compiles src alone, so its root is src, not the repo. */
const tsOptions = { clean: true, include: tsInclude };

const browserBabel = () =>
  babel({
    exclude: 'node_modules/**',
    babelHelpers: 'bundled',
    extensions: ['.ts', '.js', '.tsx', '.jsx'],
  });

const nodeBabel = () =>
  babel({
    exclude: 'node_modules/**',
    babelHelpers: 'bundled',
    extensions: ['.ts', '.js'],
    babelrc: false,
    configFile: false,
    presets: [
      ['@babel/preset-env', { targets: { node: '18' } }],
      '@babel/preset-typescript',
    ],
  });

/** A bundle for the browser. Subpaths import the core from
 *  "@withone/connect" and leave it external, so an app that loads both
 *  the hook and a framework wrapper runs one copy of the core. */
const browserBuild = (name, externals = []) => ({
  input: `src/${name}.ts`,
  external: ['@withone/connect', ...externals],
  output: [
    { file: `dist/${name}.cjs.js`, format: 'cjs', exports: 'auto' },
    { file: `dist/${name}.esm.js`, format: 'es' },
  ],
  plugins: [
    typescript(tsOptions),
    json(),
    resolve({
      browser: true,
      preferBuiltins: false,
      extensions: ['.mjs', '.js', '.json', '.ts', '.tsx'],
    }),
    browserBabel(),
    commonjs(),
    terser(),
  ],
});

/** A bundle for the server: Node built-ins stay external, no minify. */
const serverBuild = (name, externals = []) => ({
  input: `src/${name}.ts`,
  external: [/^node:/, '@withone/connect/server', '@withone/connect/next', ...externals],
  output: [
    { file: `dist/${name}.cjs.js`, format: 'cjs', exports: 'auto' },
    { file: `dist/${name}.esm.js`, format: 'es' },
  ],
  plugins: [
    typescript(tsOptions),
    json(),
    resolve({ preferBuiltins: true, extensions: ['.mjs', '.js', '.json', '.ts'] }),
    nodeBabel(),
    commonjs(),
  ],
});

export default [
  {
    ...browserBuild('index'),
    external: [],
  },
  browserBuild('react', ['react']),
  browserBuild('vue', ['vue']),
  browserBuild('svelte'),
  serverBuild('server/index'),
  serverBuild('next'),
  serverBuild('node'),
];
