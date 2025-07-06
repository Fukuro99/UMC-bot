require('dotenv').config();

/**
 * Application configuration based on environment
 */
const config = {
  development: {
    // Resonite Account Settings
    username: process.env.RESONITE_USERNAME || '',
    password: process.env.RESONITE_PASSWORD || '',
    TOTP: process.env.RESONITE_TOTP || '',
    
    // Bot Behavior Settings
    autoAcceptFriendRequests: process.env.AUTO_ACCEPT_FRIEND_REQUESTS === 'true' || false,
    autoExtendLogin: process.env.AUTO_EXTEND_LOGIN !== 'false',
    updateStatus: process.env.UPDATE_STATUS !== 'false',
    readMessagesOnReceive: process.env.READ_MESSAGES_ON_RECEIVE !== 'false',
    
    // Bot Identity
    versionName: process.env.VERSION_NAME || 'UMC-bot Development',
    
    // Logging Settings
    logToFile: process.env.LOG_TO_FILE === 'true' || false,
    logPath: process.env.LOG_PATH || './',
    logLevel: process.env.LOG_LEVEL || 'INFO',
    
    // Development specific settings
    enableDebugMode: true,
    reconnectAttempts: 3,
    heartbeatInterval: 30000
  },
  
  production: {
    // Resonite Account Settings
    username: process.env.RESONITE_USERNAME || '',
    password: process.env.RESONITE_PASSWORD || '',
    TOTP: process.env.RESONITE_TOTP || '',
    
    // Bot Behavior Settings
    autoAcceptFriendRequests: process.env.AUTO_ACCEPT_FRIEND_REQUESTS === 'true' || false,
    autoExtendLogin: process.env.AUTO_EXTEND_LOGIN !== 'false',
    updateStatus: process.env.UPDATE_STATUS !== 'false',
    readMessagesOnReceive: process.env.READ_MESSAGES_ON_RECEIVE !== 'false',
    
    // Bot Identity
    versionName: process.env.VERSION_NAME || 'UMC-bot',
    
    // Logging Settings (Production optimized)
    logToFile: false, // Render uses console logging
    logPath: process.env.LOG_PATH || './',
    logLevel: process.env.LOG_LEVEL || 'INFO',
    
    // Production specific settings
    enableDebugMode: false,
    reconnectAttempts: 10,
    heartbeatInterval: 60000,
    
    // Performance settings
    maxReconnectDelay: 30000,
    connectionTimeout: 15000
  },
  
  test: {
    // Test environment settings
    username: 'test_user',
    password: 'test_password',
    TOTP: '',
    autoAcceptFriendRequests: false,
    autoExtendLogin: false,
    updateStatus: false,
    readMessagesOnReceive: false,
    versionName: 'UMC-bot Test',
    logToFile: false,
    logPath: './',
    logLevel: 'DEBUG',
    enableDebugMode: true,
    reconnectAttempts: 1
  }
};

// Validate required environment variables in production
function validateConfig(env) {
  const currentConfig = config[env];
  const requiredVars = ['username', 'password'];
  
  if (env === 'production') {
    for (const varName of requiredVars) {
      if (!currentConfig[varName]) {
        throw new Error(`Missing required environment variable: ${varName.toUpperCase()}`);
      }
    }
  }
  
  return currentConfig;
}

const environment = process.env.NODE_ENV || 'development';
const currentConfig = validateConfig(environment);

// Add environment info to config
currentConfig.environment = environment;
currentConfig.isProduction = environment === 'production';
currentConfig.isDevelopment = environment === 'development';

module.exports = currentConfig;