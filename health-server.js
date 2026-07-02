/**
 * Simple HTTP server for health checks and external commands (Render requirement)
 */

const http = require('http');

class HealthServer {
    constructor(port = process.env.PORT || 3000) {
        this.port = port;
        this.server = null;
        this.botStatus = 'starting';
        this.botInstance = null; // Bot instance reference
        this.apiKey = process.env.API_KEY || 'default-key-change-in-production'; // API key for security
    }
    
    // Set bot instance reference for command execution
    setBotInstance(bot) {
        this.botInstance = bot;

        // Map MVContactBot connection states onto our botStatus field so /health
        // reflects whether SignalR is actually alive, not just process liveness.
        const statusMap = {
            connecting: 'starting',
            connected: 'running',
            reconnecting: 'reconnecting',
            disconnected: 'disconnected'
        };

        bot.on('connectionStatusChanged', (newStatus) => {
            const mapped = statusMap[newStatus] || newStatus;
            this.setBotStatus(mapped);
            console.log(`🏥 Bot connection status changed: ${newStatus} (botStatus=${mapped})`);
        });
    }
    
    start() {
        // Check if server is already running
        if (this.server && this.server.listening) {
            console.log(`🏥 Health server already running on port ${this.port}`);
            return;
        }
        
        this.server = http.createServer(async (req, res) => {
            // Enable CORS
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
            
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            
            try {
                if (req.url === '/health' || req.url === '/') {
                    await this.handleHealthCheck(req, res);
                } else if (req.url === '/api/command' && req.method === 'POST') {
                    await this.handleCommand(req, res);
                } else if (req.url === '/api/status' && req.method === 'GET') {
                    await this.handleStatusCheck(req, res);
                } else if (req.url === '/otp' && req.method === 'POST') {
                    await this.handleOtpRequest(req, res);
                } else {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Endpoint not found' }));
                }
            } catch (error) {
                console.error('🏥 Server error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error' }));
            }
        });
        
        this.server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`🏥 Port ${this.port} is busy, trying alternative...`);
                // Try alternative port
                this.port = this.port + 1;
                setTimeout(() => this.start(), 1000);
            } else {
                console.error('🏥 Health server error:', err);
            }
        });
        
        this.server.listen(this.port, '0.0.0.0', () => {
            console.log(`🏥 Health server running on port ${this.port}`);
            console.log(`🔑 API Key: ${this.apiKey}`);
            console.log(`🔢 OTP endpoint available at: /otp`);
        });
    }
    
    // Handle OTP requests
    async handleOtpRequest(req, res) {
        try {
            // Parse request body
            const body = await this.parseRequestBody(req);
            
            // Validate required fields
            if (!body.userID || !body.otp) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: 'Missing required fields: userID and otp are required',
                    received: body
                }));
                return;
            }
            
            // Validate bot instance
            if (!this.botInstance) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: 'Bot instance not available' 
                }));
                return;
            }
            
            // Check if bot is logged in
            if (!this.botInstance.data || !this.botInstance.data.loggedIn) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: 'Bot is not logged in' 
                }));
                return;
            }
            
            // Send OTP message to the specified user
            try {
                await this.botInstance.sendTextMessage(body.userID, body.otp);
                
                // Log the OTP send action
                if (this.botInstance.logger) {
                    await this.botInstance.logger.log("INFO", `📤 OTP sent to ${body.userID}: ${body.otp}`);
                }
                
                console.log(`📤 OTP sent to ${body.userID}: ${body.otp}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    message: 'OTP sent successfully',
                    userID: body.userID,
                    timestamp: new Date().toISOString()
                }));
                
            } catch (sendError) {
                console.error(`🚨 Failed to send OTP to ${body.userID}:`, sendError);
                
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: false,
                    error: 'Failed to send OTP message',
                    details: sendError.message,
                    userID: body.userID
                }));
            }
            
        } catch (error) {
            console.error('🚨 OTP endpoint error:', error);
            
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: 'Internal server error',
                details: error.message
            }));
        }
    }
    
    // Handle health check requests
    async handleHealthCheck(req, res) {
        const isOnline = this._safeIsOnline();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            botStatus: this.botStatus,
            isOnline: isOnline,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: require('./package.json').version,
            environment: process.env.NODE_ENV || 'development'
        }));
    }

    // Handle status check requests
    async handleStatusCheck(req, res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            botStatus: this.botStatus,
            isOnline: this._safeIsOnline(),
            timestamp: new Date().toISOString()
        }));
    }

    _safeIsOnline() {
        try {
            return this.botInstance && typeof this.botInstance.isOnline === 'function'
                ? this.botInstance.isOnline()
                : false;
        } catch (err) {
            console.error('🏥 isOnline() threw:', err);
            return false;
        }
    }
    
    // Handle command requests
    async handleCommand(req, res) {
        // Parse request body
        const body = await this.parseRequestBody(req);
        
        // Validate API key
        const authHeader = req.headers.authorization;
        if (!authHeader || authHeader !== `Bearer ${this.apiKey}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized - Invalid API key' }));
            return;
        }
        
        // Validate command structure
        if (!body.command) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing command parameter' }));
            return;
        }
        
        try {
            const result = await this.executeCommand(body.command, body.parameters || {});
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: true,
                command: body.command,
                result: result,
                timestamp: new Date().toISOString()
            }));
            
            console.log(`🔧 External command executed: ${body.command}`, body.parameters || {});
            
        } catch (error) {
            const statusCode = error.code === 'NOT_FRIEND' ? 409 : 400;
            res.writeHead(statusCode, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                success: false,
                error: error.message,
                code: error.code || null,
                command: body.command
            }));

            // NOT_FRIEND は設計通りの経路 (未フレンド検知→フレンド申請送信) なので
            // 障害とは区別して INFO レベルでログする
            if (error.code === 'NOT_FRIEND') {
                console.log(`ℹ️ ${body.command}: ${error.message}`);
            } else {
                console.error(`🚨 Command execution failed: ${body.command}`, error);
            }
        }
    }
    
    // Parse request body
    parseRequestBody(req) {
        return new Promise((resolve, reject) => {
            let body = '';
            
            req.on('data', (chunk) => {
                body += chunk.toString();
            });
            
            req.on('end', () => {
                try {
                    if (body) {
                        const parsed = JSON.parse(body);
                        resolve(parsed);
                    } else {
                        resolve({});
                    }
                } catch (error) {
                    reject(new Error('Invalid JSON in request body'));
                }
            });
            
            req.on('error', (error) => {
                reject(error);
            });
        });
    }
    
    // Execute commands
    async executeCommand(command, parameters) {
        if (!this.botInstance) {
            throw new Error('Bot instance not available');
        }
        
        switch (command.toLowerCase()) {
            case 'send_message': {
                if (!parameters.userId || !parameters.message) {
                    throw new Error('Missing required parameters: userId and message');
                }
                // Resoniteはフレンド以外にメッセージを送ってもHub側は成功を返してしまい
                // 受信側に届かないので、送信前にフレンド状態を確認する
                const isFriend = await this.botInstance.isFriendWith(parameters.userId);
                if (!isFriend) {
                    try {
                        await this.botInstance.addFriend(parameters.userId);
                    } catch (err) {
                        console.error(`Failed to send friend request to ${parameters.userId}:`, err.message);
                    }
                    const error = new Error('Recipient is not a friend. A friend request has been sent.');
                    error.code = 'NOT_FRIEND';
                    throw error;
                }
                await this.botInstance.sendTextMessage(parameters.userId, parameters.message);
                return { message: 'Message sent successfully' };
            }
                
            case 'get_status':
                return {
                    botStatus: this.botStatus,
                    isOnline: this.botInstance.isOnline(),
                    uptime: process.uptime()
                };
                
            case 'restart':
                if (parameters.confirm !== 'true') {
                    throw new Error('Restart requires confirmation parameter set to true');
                }
                // Trigger graceful restart
                setTimeout(() => {
                    process.emit('SIGTERM');
                }, 1000);
                return { message: 'Restart initiated' };
                
            case 'custom_action':
                // Custom action handling - you can extend this
                if (!parameters.action) {
                    throw new Error('Missing action parameter');
                }
                return { message: `Custom action '${parameters.action}' executed`, parameters };
                
            default:
                throw new Error(`Unknown command: ${command}`);
        }
    }
    
    setBotStatus(status) {
        this.botStatus = status;
    }
    
    stop() {
        if (this.server) {
            this.server.close();
            console.log('🏥 Health server stopped');
        }
    }
}

module.exports = HealthServer;