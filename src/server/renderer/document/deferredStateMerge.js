// No imports: Body.jsx (and so this file) is part of the package entry that client bundles load.

/**
 * Run right after window.__INITIAL_STATE__ is assigned (Body.jsx): merges the state slices of
 * <Deferred> sections written before it (see server/renderer/deferred.js), then drops the
 * temporary object. Only own properties of a plain object are merged, so a DOM element with that
 * id (named access on window) is ignored.
 */
export const DEFERRED_STATE_MERGE =
    ";(function(d,s){if(!d||!s||Object.getPrototypeOf(d)!==Object.prototype)return;" +
    "for(var k in d)if(Object.prototype.hasOwnProperty.call(d,k))s[k]=d[k];" +
    "try{delete window.__CATALYST_DEFERRED_STATE__}catch(e){}})(window.__CATALYST_DEFERRED_STATE__,window.__INITIAL_STATE__)"
