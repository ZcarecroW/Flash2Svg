// Stands in for @eshaz/web-worker in the bundles (scripts/build.mjs): mpg123-decoder's worker
// variant, which we don't use, extends it when the module loads; the real one requires Node
// modules the ESM bundle can't load.
export default class NoWorker {}
