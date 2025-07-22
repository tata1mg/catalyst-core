#!/bin/bash
npm run prepare
# Copy dist folder to Documents/1mg_projects/pwa/1mg_web/mweb/node_modules/catalyst-core
cp -r dist ~/Documents/1mg_projects/pwa/1mg_web/mweb/node_modules/catalyst-core
cp package.json ~/Documents/1mg_projects/pwa/1mg_web/mweb/node_modules/catalyst-core
cp -r bin ~/Documents/1mg_projects/pwa/1mg_web/mweb/node_modules/catalyst-core
cp package-lock.json ~/Documents/1mg_projects/pwa/1mg_web/mweb/node_modules/catalyst-core



