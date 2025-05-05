# Install root dependencies
npm i

# Install template dependencies
cd template
npm i
cd ..

# Build catalyst
npm run prepare

# Copy catalyst as a command
cp template/bin/catalyst.js template/node_modules/.bin/catalyst

# Make it executable
chmod +x template/node_modules/.bin/catalyst

# Build and run test cases of template app
cd template
npm run build
npm run test
cd ..