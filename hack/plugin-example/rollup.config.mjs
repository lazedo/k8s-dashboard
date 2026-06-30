// Bundle the ngc-compiled plugin into an AMD module whose named deps are the
// externals the dashboard registers in SystemJS (ng.core, ng.common, rxjs, tslib).
// SystemJS (with the amd.js extra) imports it; `default.default` is the NgModuleFactory.
import nodeResolve from '@rollup/plugin-node-resolve';

const externals = {
  '@angular/core': 'ng.core',
  '@angular/common': 'ng.common',
  '@angular/forms': 'ng.forms',
  '@angular/router': 'ng.router',
  rxjs: 'rxjs',
  'rxjs/operators': 'rxjs/operators',
  tslib: 'tslib',
};

export default {
  input: 'out-tsc/plugin.js',
  external: Object.keys(externals),
  output: {
    file: 'dist/plugin.js',
    format: 'amd',
    amd: {id: 'plugin'},
    paths: externals, // import '@angular/core' -> AMD dep 'ng.core'
    exports: 'named',
  },
  plugins: [nodeResolve()],
  onwarn(w, warn) {
    if (w.code === 'THIS_IS_UNDEFINED') return;
    warn(w);
  },
};
