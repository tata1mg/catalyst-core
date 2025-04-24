# Install root dependencies
npm ci

# Install template dependencies
cd template
npm ci
cd ..

# Build catalyst
npm run prepare

# Copy catalyst as a command
cp template/bin/catalyst.js template/node_modules/.bin/catalyst

# Make it executable
chmod +x template/node_modules/.bin/catalyst

# Run test cases of template app
cd template
npm run test:dev
cd ..