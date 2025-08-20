/**
 * UMC-bot Application Entry Point
 * Resonite Bot for UMC Bank
 */

const { MVContactBot } = require('./index');
const config = require('./config/index');
const HealthServer = require('./health-server');

// Graceful shutdown handler
let bot = null;
let healthServer = null;
let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    
    console.log(`\n[${new Date().toISOString()}] Received ${signal}. Shutting down gracefully...`);
    
    if (bot) {
        try {
            console.log('[SHUTDOWN] Stopping bot...');
            await bot.stop();
            console.log('[SHUTDOWN] Bot stopped successfully');
            
            console.log('[SHUTDOWN] Logging out...');
            await bot.logout();
            console.log('[SHUTDOWN] Logout successful');
        } catch (error) {
            console.error('[SHUTDOWN] Error during shutdown:', error.message);
        }
    }
    
    if (healthServer) {
        healthServer.stop();
    }
    
    console.log('[SHUTDOWN] Process exiting...');
    process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('[FATAL] Uncaught Exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('UNHANDLED_REJECTION');
});

// Main application function
async function startBot() {
    console.log('='.repeat(50));
    console.log('UMC-bot Starting...');
    console.log(`Environment: ${config.environment}`);
    console.log(`Version: ${config.versionName}`);
    console.log(`Username: ${config.username}`);
    console.log('='.repeat(50));
    
    try {
        // Start health server first (Render requirement)
        if (!healthServer) {
            healthServer = new HealthServer();
            healthServer.start();
            healthServer.setBotStatus('initializing');
        }
        
        // Validate configuration
        if (!config.username || !config.password) {
            throw new Error('Missing required configuration: username and password must be set');
        }
        
        // Create bot instance
        bot = new MVContactBot(config);
        
        // Set bot instance in health server for OTP and command functionality
        healthServer.setBotInstance(bot);
        
        // Set up event handlers
        setupEventHandlers(bot);
        
        // Login
        console.log('Logging in...');
        healthServer.setBotStatus('logging_in');
        await bot.login();
        console.log('Login successful');
        
        // Start bot
        console.log('Starting bot...');
        healthServer.setBotStatus('starting');
        await bot.start();
        console.log('Bot started successfully');
        healthServer.setBotStatus('running');
        
        console.log('UMC-bot is now running and ready to serve!');
        console.log('OTP endpoint is available at /otp');
        console.log('Press Ctrl+C to stop the bot gracefully');
        
        // Keep the process alive
        setInterval(() => {
            if (!isShuttingDown) {
                console.log(`[${new Date().toISOString()}] Bot is running... (PID: ${process.pid})`);
            }
        }, 300000); // Log every 5 minutes
        
    } catch (error) {
        console.error('Failed to start bot:', error.message);
        
        if (healthServer) {
            healthServer.setBotStatus('error');
        }
        
        if (error.message.includes('Unexpected return code')) {
            console.error('Login failed. Please check your credentials and TOTP token.');
        }
        
        console.error('Retrying in 30 seconds...');
        setTimeout(() => {
            if (!isShuttingDown) {
                startBot();
            }
        }, 30000);
    }
}

// Event handlers for bot
function setupEventHandlers(bot) {
    // Message events
    bot.on('receiveTextMessage', (senderId, message) => {
        console.log(`Text message from ${senderId}: ${message}`);
        
        // Auto-respond to specific messages (you can customize this)
        if (message.toLowerCase().includes('hello') || message.toLowerCase().includes('hi')) {
            bot.sendTextMessage(senderId, 'Hello! I am the UMC Bank bot. How can I assist you today?');
        }
    
    });
    
    bot.on('receiveSoundMessage', (senderId, soundUrl) => {
        console.log(`Sound message from ${senderId}: ${soundUrl}`);
    });
    
    bot.on('receiveObjectMessage', (senderId, objectName, objectUrl) => {
        console.log(`Object message from ${senderId}: ${objectName} - ${objectUrl}`);
    });
    
    bot.on('receiveSessionInviteMessage', (senderId, sessionName, sessionId) => {
        console.log(`Session invite from ${senderId}: ${sessionName} (${sessionId})`);
    });
    
    // Friend management events
    bot.on('addedContact', (friendId) => {
        console.log(`Added new friend: ${friendId}`);
    });
    
    // Error handling
    bot.on('error', (error) => {
        console.error('Bot error:', error);
    });
}

// Start the application
console.log('Initializing UMC-bot...');
startBot().catch(console.error);

// Export for testing purposes
module.exports = { startBot, gracefulShutdown };