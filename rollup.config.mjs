import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import typescript from '@rollup/plugin-typescript';
import importAssets from 'rollup-plugin-import-assets';
import postcss from 'rollup-plugin-postcss';
import { readFileSync } from 'fs';

// Read plugin.json with plain fs instead of a JSON ES-module import: recent
// Node versions require an explicit `with { type: 'json' }` import
// attribute for JSON ESM imports, which older Node/rollup toolchains don't
// understand yet. Reading it manually works identically on every Node
// version we care about.
const { name } = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url)));

export default {
  input: './src/index.tsx',
  plugins: [
    commonjs(),
    nodeResolve(),
    typescript(),
    json(),
    // `src/styles/overlay.css` is imported directly from index.tsx; without
    // this plugin Rollup tries to parse the raw CSS as JavaScript and the
    // build fails outright. `inject: true` (the default) injects the CSS
    // into the Steam client's own document via a <style> tag at runtime,
    // which is exactly what an overlay mounted onto document.body needs.
    postcss({ inject: true, minimize: true }),
    replace({
      preventAssignment: false,
      'process.env.NODE_ENV': JSON.stringify('production'),
    }),
    importAssets({
      publicPath: `http://127.0.0.1:1337/plugins/${name}/`,
    }),
  ],
  context: 'window',
  external: ['react', 'react-dom', 'decky-frontend-lib'],
  output: {
    file: 'dist/index.js',
    // Deliberately NOT setting `output.name` here (Rollup will print a
    // warning about it, which is safe to ignore for this project): naming
    // an IIFE output makes Rollup wrap it as `var SomeName = (function(){
    // ... })();` - a variable declaration statement. Decky Loader's legacy
    // plugin loader (`PluginLoadType.LEGACY_EVAL_IIFE`) runs this file
    // through a bare `eval()` and uses *the completion value of the last
    // statement* as the plugin's default export. A variable declaration's
    // completion value is always `undefined` per the JS spec, so naming
    // the output would make `eval()` silently return `undefined` instead
    // of the plugin factory function, breaking every install. Leaving the
    // output unnamed keeps it a bare expression statement
    // `(function(){ ... })();`, whose completion value is exactly the
    // returned default export - which is what Decky actually needs.
    globals: {
      react: 'SP_REACT',
      'react-dom': 'SP_REACTDOM',
      'decky-frontend-lib': 'DFL',
    },
    format: 'iife',
    exports: 'default',
  },
};
