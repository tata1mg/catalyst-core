# Changelog

## [0.0.1-beta.6] - 28-06-2024

### Changes

-   Moved router, scripts, server and webpack directories present in root directoy to dist folder
-   Removed dependency from user defined module aliases (user can change any module alias without breaking catalyst) 
-   Module aliases defined for catalyst
-   Added exports inside package.json for tree shakeable support for logger, caching and ClientRouter.js
-   Hidden unnecessary files from published package: 
    .prettierrc.json
    .eslintrc
    .eslintignore
    /.husky 
    /.github
    commitlint.config.js
    tsconfig.json