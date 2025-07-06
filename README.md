# UMC-bot 🤖

UMC Bank's official Resonite bot for customer service and community management.

## Features

- 🔐 Automatic login with environment variable configuration
- 👥 Auto-accept friend requests
- 💬 Intelligent message handling and responses
- 🔄 Auto-reconnection and session management
- 🏥 Health monitoring for production deployment
- 📊 Comprehensive logging and monitoring

## Quick Start

### Local Development

1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/Fukuro99/UMC_BalanceDB.git
   cd UMC-bot
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your Resonite credentials
   ```

3. **Run the bot:**
   ```bash
   npm run dev
   ```

### Production Deployment (Render)

1. **Set environment variables in Render dashboard:**
   ```
   RESONITE_USERNAME=bank@umcapp.org
   RESONITE_PASSWORD=your_password
   RESONITE_TOTP=your_totp_token
   NODE_ENV=production
   ```

2. **Deploy:**
   - Connect your GitHub repository to Render
   - Use the included `render.yaml` configuration
   - Deploy automatically triggers on git push

## Environment Variables

### Required
- `RESONITE_USERNAME` - Resonite account username
- `RESONITE_PASSWORD` - Resonite account password

### Optional
- `RESONITE_TOTP` - TOTP token if 2FA is enabled
- `NODE_ENV` - Environment (development/production/test)
- `AUTO_ACCEPT_FRIEND_REQUESTS` - Auto-accept friend requests (true/false)
- `VERSION_NAME` - Bot version name displayed in Resonite
- `LOG_LEVEL` - Logging level (DEBUG/INFO/WARN/ERROR)

## Project Structure

```
UMC-bot/
├── app.js              # Main application entry point
├── index.js            # Bot class implementation
├── config/             # Environment-based configuration
│   └── index.js       
├── health-server.js    # Health check server for Render
├── logging.js          # Logging utilities
├── .env.example       # Environment variables template
├── render.yaml        # Render deployment configuration
└── package.json       # Dependencies and scripts
```

## Scripts

- `npm start` - Start bot in production mode
- `npm run dev` - Start bot in development mode
- `npm test` - Start bot in test mode
- `npm run validate-env` - Validate environment configuration

## Health Monitoring

The bot includes a health check endpoint at `/health` that returns:

```json
{
  "status": "ok",
  "botStatus": "running",
  "timestamp": "2025-07-06T12:00:00.000Z",
  "uptime": 3600,
  "version": "1.0.0",
  "environment": "production"
}
```

## Bot Commands & Responses

The bot automatically responds to common greetings and can be extended with custom commands.

Current auto-responses:
- "hello" / "hi" → Friendly greeting with UMC Bank introduction

## Security

- ✅ Environment variables for sensitive data
- ✅ Graceful shutdown handling
- ✅ Error handling and retry logic
- ✅ Production-ready logging
- ✅ TOTP support for 2FA

## Troubleshooting

### Common Issues

1. **Login Failed**
   - Verify RESONITE_USERNAME and RESONITE_PASSWORD
   - Check if TOTP is required and properly set

2. **Connection Issues**
   - Bot will automatically retry connections
   - Check Resonite API status

3. **Environment Variables**
   - Use `npm run validate-env` to check configuration
   - Ensure all required variables are set

### Logs

Development logs include detailed information about:
- Login attempts and status
- Message received/sent
- Friend requests processed
- Connection status changes
- Error details

## Support

For issues related to UMC Bank services, contact: bank@umcapp.org

## License

MIT License - see LICENSE file for details.