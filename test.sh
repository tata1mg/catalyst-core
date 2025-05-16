# Exits for any failed command
set -e

# Install root dependencies
npm ci

# Install template dependencies
cd template
npm ci
cd ..

# Build catalyst
npm run prepare

# Replace built catalyst in template
rm -rf template/node_modules/catalyst-core/dist
mv dist template/node_modules/catalyst-core/

# Run test cases of template app
cd template
npm run build
npm run test
cd ..