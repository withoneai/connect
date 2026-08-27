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

export default {
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
