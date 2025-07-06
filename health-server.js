/**
 * Simple HTTP server for health checks (Render requirement)
 */

const http = require('http');

class HealthServer {
    constructor(port = process.env.PORT || 3000) {
        this.port = port;
        this.server = null;
        this.botStatus = 'starting';
    }
    
    start() {
        // Check if server is already running
        if (this.server && this.server.listening) {
            console.log(`🏥 Health server already running on port ${this.port}`);
            return;
        }
        
        this.server = http.createServer((req, res) => {
            // Enable CORS
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            
            if (req.url === '/health' || req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    status: 'ok',
                    botStatus: this.botStatus,
                    timestamp: new Date().toISOString(),
                    uptime: process.uptime(),
                    version: require('./package.json').version,
                    environment: process.env.NODE_ENV || 'development'
                }));
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
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
        });
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