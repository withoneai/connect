import babel from '@rollup/plugin-babel';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from 'rollup-plugin-typescript2';
import copy from 'rollup-plugin-copy';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const base = {
  input: 'src/index.ts',
  external: [],
  output: [
    { file: pkg.main, format: 'cjs', exports: 'auto' },
    { file: pkg.module, format: 'es' },
  ],
  plugins: [
    typescript({
      clean: true,
      // rpt2's default include globs use the extglob `+(|x)` (an empty
      // alternative), which picomatch >= 2.3.2 no longer matches. When it
      // stops matching, rpt2 silently transforms nothing: no type-checking
      // and no .d.ts emitted, while Babel still strips types so the JS
      // bundle builds clean. Match the extensions explicitly instead.
      include: ['src/**/*.ts', 'src/**/*.tsx'],
    }),
    json(),
    copy({
      targets: [{ src: 'src/types', dest: 'dist' }],
    }),
    resolve({
      browser: true,
      preferBuiltins: false,
      extensions: ['.mjs', '.js', '.json', '.node', '.jsx', '.ts', '.tsx'],
    }),
    babel({
      exclude: 'node_modules/**',
      babelHelpers: 'bundled',
      extensions: ['.ts', '.js', '.tsx', '.jsx'],
    }),
    commonjs(),
    terser(),
  ],
};

const reactBuild = {
  input: 'src/react.ts',
  external: ['react'],
  output: [
    { file: 'dist/react.cjs.js', format: 'cjs', exports: 'auto' },
    { file: 'dist/react.esm.js', format: 'es' },
  ],
  plugins: [
    typescript({ clean: true, include: ['src/**/*.ts', 'src/**/*.tsx'] }),
    json(),
    copy({ targets: [{ src: 'src/react-types.d.ts', dest: 'dist', rename: 'react.d.ts' }] }),
    resolve({ browser: true, preferBuiltins: false, extensions: ['.mjs', '.js', '.json', '.node', '.jsx', '.ts', '.tsx'] }),
    babel({ exclude: 'node_modules/**', babelHelpers: 'bundled', extensions: ['.ts', '.js', '.tsx', '.jsx'] }),
    commonjs(),
    terser(),
  ],
};

const subBuild = (name, externals) => ({
  input: `src/${name}.ts`,
  external: externals,
  output: [
    { file: `dist/${name}.cjs.js`, format: 'cjs', exports: 'auto' },
    { file: `dist/${name}.esm.js`, format: 'es' },
  ],
  plugins: [
    typescript({ clean: true, include: ['src/**/*.ts', 'src/**/*.tsx'] }),
    json(),
    copy({ targets: [{ src: `src/${name}-types.d.ts`, dest: 'dist', rename: `${name}.d.ts` }] }),
    resolve({ browser: true, preferBuiltins: false, extensions: ['.mjs', '.js', '.json', '.node', '.jsx', '.ts', '.tsx'] }),
    babel({ exclude: 'node_modules/**', babelHelpers: 'bundled', extensions: ['.ts', '.js', '.tsx', '.jsx'] }),
    commonjs(),
    terser(),
  ],
});

export default [base, reactBuild, subBuild('vue', ['vue']), subBuild('svelte', [])];
