const { exec, execSync } = require("child_process");
const fs = require("fs");

/**
 * Get local IP address on macOS using ifconfig
 */
function getLocalIPAddress() {
    try {
        const command = `ifconfig | grep "inet " | grep -v 127.0.0.1 | head -n 1 | awk '{print $2}'`;
        return execSync(command).toString().trim();
    } catch (error) {
        console.warn('Could not get local IP, using localhost');
        return 'localhost';
    }
}

/**
 * Check if server is running on given port
 */
async function isServerRunning(port) {
    return new Promise((resolve) => {
        const command = `lsof -i :${port}`;
        exec(command, (error, stdout) => {
            if (error) {
                resolve(false);
                return;
            }
            resolve(stdout.includes('LISTEN'));
        });
    });
}

/**
 * Start server in background using npm start
 */
function startServerBackground() {
    console.log('Starting server in background...');
    const serverProcess = exec('npm start', { 
        detached: true,
        stdio: 'ignore'
    });
    
    if (serverProcess.pid) {
        serverProcess.unref(); // Allow parent to exit
        console.log('Server started in background');
    }
}

/**
 * Recursively replace localhost and different IPs with current local IP
 */
function replaceIPInObject(obj, localIP, path = '') {
    let updated = false;
    
    for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;
        
        if (typeof value === 'string') {
            let newValue = value;
            let shouldUpdate = false;
            
            // Replace localhost with local IP
            if (value.includes('localhost')) {
                newValue = value.replace(/localhost/g, localIP);
                shouldUpdate = true;
            }
            
            // Replace different IP addresses in URLs
            const urlPattern = /http:\/\/(\d+\.\d+\.\d+\.\d+)/g;
            const matches = [...value.matchAll(urlPattern)];
            for (const match of matches) {
                if (match[1] !== localIP) {
                    newValue = newValue.replace(match[1], localIP);
                    shouldUpdate = true;
                }
            }
            
            // Replace standalone IP addresses that are not localhost
            const ipPattern = /^(\d+\.\d+\.\d+\.\d+)$/;
            const ipMatch = value.match(ipPattern);
            if (ipMatch && ipMatch[1] !== localIP) {
                newValue = localIP;
                shouldUpdate = true;
            }
            
            if (shouldUpdate && newValue !== value) {
                console.log(`Updating ${currentPath}: ${value} -> ${newValue}`);
                obj[key] = newValue;
                updated = true;
            }
        } else if (typeof value === 'object' && value !== null) {
            // Recursively process nested objects
            const nestedUpdated = replaceIPInObject(value, localIP, currentPath);
            updated = updated || nestedUpdated;
        }
    }
    
    return updated;
}

/**
 * Update config.json with current local IP address
 */
function updateConfigWithLocalIP(configPath, localIP) {
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        
        // Recursively update all IP addresses in the config
        const updated = replaceIPInObject(config, localIP);

        // Write back if updated
        if (updated) {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
            console.log('Configuration updated with current IP address');
        } else {
            console.log('No IP addresses needed updating in configuration');
        }

        return config;
    } catch (error) {
        console.error('Error updating config:', error.message);
        throw error;
    }
}

/**
 * Main function: Setup server with IP validation and background startup
 * @param {string} configPath - Path to config.json file
 * @returns {Promise<{serverURL: string, localIP: string, port: number}>}
 */
async function setupServer(configPath) {
    console.log('Setting up server...');
    
    // Get local IP
    const localIP = getLocalIPAddress();
    console.log(`Local IP: ${localIP}`);
    
    // Update config with current IP
    const config = updateConfigWithLocalIP(configPath, localIP);
    
    // Get port from config
    const port = config.WEBVIEW_CONFIG?.port || 3005;
    const serverURL = `http://${localIP}:${port}`;
    
    // Check if server is running
    const running = await isServerRunning(port);
    
    if (!running) {
        console.log(`Server not running on ${serverURL}, starting...`);
        startServerBackground();
        // Give it a moment to start
        await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
        console.log(`Server already running on ${serverURL}`);
    }
    
    console.log(`Server setup complete: ${serverURL}`);
    
    return {
        serverURL,
        localIP,
        port
    };
}

module.exports = { setupServer };