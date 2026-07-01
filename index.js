const signalR = require("@microsoft/signalr");
const {randomUUID, createHash, randomBytes} = require("crypto");
const EventEmitter = require('events');
const {botLog} = require("./logging");
const path = require("path");

const baseAPIURL = "https://api.resonite.com";
const resoniteKey = "oi+ISZuYtMYtpruYHLQLPkXgPaD+IcaRNXPI7b3Z0iYe5+AcccouLYFI9vloMmYEYDlE1PhDL52GsddfxgQeK4Z_hem84t1OXGUdScFkLSMhJA2te86LBL_rFL4JjO4F_hHHIJH1Gm1IYVuvBQjpb89AJ0D6eamd7u4MxeWeEVE=";
const botUID = GenerateUID();

/**
 * Does a cool thing
 * @class
 * @param inConfig is a cool object full of settings.
 */
class MVContactBot extends EventEmitter {
    constructor(inConfig) {
        super();
        this.config = {
            "username": inConfig.username,
            "password": inConfig.password,
            "TOTP": inConfig.TOTP ?? "",
            "autoAcceptFriendRequests": inConfig.autoAcceptFriendRequests ?? "all", // Re-enable auto friend accept
            "autoExtendLogin": inConfig.autoExtendLogin ?? true,
            "updateStatus": inConfig.updateStatus ?? true,
            "readMessagesOnReceive": inConfig.readMessagesOnReceive ?? true,
            "versionName": inConfig.versionName ?? "Resonite Contact Bot",
            "logToFile": inConfig.logToFile ?? true,
            "logPath": inConfig.logPath ?? "./"
        }
        this.data = {
            "currentMachineID": GenerateRandomMachineId(),
            "sessionId": randomUUID(),
            "userId": "",
            "token": "",
            "fullToken": "",
            "tokenExpiry": "",
            "loggedIn": false,
            "whitelist": [],
            "connectionStatus": "disconnected",
            "stopRequested": false
        }
        this.autoRunners = {};
        this.signalRConnection = undefined;
        this._reconnectTimer = undefined;
        this._reconnectAttempts = 0;
        this._reconnectInProgress = false;
        this.logger = new botLog(this.config.username, this.config.logToFile, this.config.logPath);
    }

    isOnline() {
        if (!this.data.loggedIn) return false;
        if (!this.signalRConnection) return false;
        return this.signalRConnection.state === signalR.HubConnectionState.Connected;
    }

    setConnectionStatus(status) {
        if (this.data.connectionStatus === status) return;
        const prev = this.data.connectionStatus;
        this.data.connectionStatus = status;
        this.logger.log("INFO", `Connection status: ${prev} -> ${status}`);
        this.emit("connectionStatusChanged", status, prev);
    }

    validateLoginCredentials() {
        // Check username format
        if (!this.config.username || this.config.username.trim() === '') {
            throw new Error('Username is empty or undefined');
        }
        
        // Log username characteristics (without revealing actual password)
        const username = this.config.username;
        this.logger.log("INFO", `Username: "${username}"`);
        this.logger.log("INFO", `Username length: ${username.length}`);
        this.logger.log("INFO", `Username contains spaces: ${username.includes(' ')}`);
        
        // Check for Japanese characters specifically
        const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(username);
        this.logger.log("INFO", `Username contains Japanese characters: ${hasJapanese}`);
        
        if (hasJapanese) {
            this.logger.log("WARNING", "Japanese characters detected in username!");
            this.logger.log("WARNING", "Resonite API may not support Japanese usernames");
            this.logger.log("WARNING", "Consider using an English/alphanumeric username instead");
        }
        
        // Check password
        if (!this.config.password || this.config.password.trim() === '') {
            throw new Error('Password is empty or undefined');
        }
        
        this.logger.log("INFO", `Password configured: Yes (length: ${this.config.password.length})`);
    }

    async login() {
        // Validate credentials first
        this.validateLoginCredentials();

        const loginData = {
            "username": this.config.username,
            "authentication": {
                "$type": "password",
                "password": this.config.password
            },
            "rememberMe": false,
            "secretMachineId": this.data.currentMachineID
        };

        try {
            await this.logger.log("INFO", `Attempting login for username: ${this.config.username}`);
            await this.logger.log("INFO", `TOTP configured: ${this.config.TOTP ? 'Yes' : 'No'}`);
            await this.logger.log("INFO", `Machine ID: ${this.data.currentMachineID.substring(0, 10)}...`);
            
            // Test basic connectivity first
            await this.logger.log("INFO", "Testing API connectivity...");
            const pingRes = await fetch(`${baseAPIURL}/`, {
                method: 'GET',
                signal: AbortSignal.timeout(10000)
            });
            await this.logger.log("INFO", `API ping status: ${pingRes.status}`);
            
            await this.logger.log("INFO", "Sending login request...");
            const res = await fetch(`${baseAPIURL}/userSessions`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json; charset=utf-8",
                        "Content-Length": JSON.stringify(loginData).length,
                        "UID": botUID,
                        "TOTP": this.config.TOTP
                    },
                    body: JSON.stringify(loginData),
                    signal: AbortSignal.timeout(45000)
                }
            );
        
            await this.logger.log("INFO", `Login response status: ${res.status}`);
            
            if (res.status === 200){
                const loginResponse = await res.json();
                this.data.userId = loginResponse.entity.userId;
                this.data.token = loginResponse.entity.token;
                this.data.fullToken = `res ${loginResponse.entity.userId}:${loginResponse.entity.token}`;
                this.data.tokenExpiry = loginResponse.entity.expire;
                this.data.loggedIn = true;
                await this.logger.log("INFO", `Successfully logged in as ${loginResponse.entity.userId}`);
            }
            else {
                const errorBody = await res.text();
                await this.logger.log("ERROR", `Login failed with status ${res.status}`);
                await this.logger.log("ERROR", `Error response: ${errorBody}`);
                
                // Analyze specific error codes
                if (res.status === 400) {
                    await this.logger.log("ERROR", "Bad Request - Check username and password format");
                    await this.logger.log("ERROR", "Hint: Japanese usernames may not be supported by Resonite API");
                } else if (res.status === 401) {
                    await this.logger.log("ERROR", "Unauthorized - Invalid credentials or TOTP required");
                } else if (res.status === 429) {
                    await this.logger.log("ERROR", "Rate limited - Too many login attempts");
                } else if (res.status >= 500) {
                    await this.logger.log("ERROR", "Server error - Resonite API issue");
                }
                
                throw new Error(`Login failed (${res.status}): ${errorBody}`);
            }
        } catch (error) {
            await this.logger.log("ERROR", `Login exception: ${error.message}`);
            await this.logger.log("ERROR", `Error type: ${error.constructor.name}`);
            
            if (error.name === 'TimeoutError' || error.code === 'ETIMEDOUT' || error.name === 'AbortError') {
                await this.logger.log("ERROR", "Login timed out - possibly slow network or server overload");
                throw new Error('Network timeout. Check your internet connection and try again.');
            } else if (error.message.includes('fetch failed')) {
                await this.logger.log("ERROR", "Network fetch failed - connectivity issue");
                throw new Error('Network connection failed. Check your internet connection and firewall settings.');
            } else if (error.message.includes('ENOTFOUND')) {
                await this.logger.log("ERROR", "DNS resolution failed");
                throw new Error('DNS resolution failed. Check your network configuration.');
            }
            throw error;
        }
    }

    async logout(){
        if(this.signalRConnection !== undefined){
            throw new Error("Please stop this bot before logging out.");
        }
        else if(!this.data.loggedIn){
            throw new Error("This bot is already logged out!");
        }
        const res = await fetch(`${baseAPIURL}/userSessions/${this.data.userId}/${this.data.token}`,
            {
                method: "DELETE",
                headers: {
                    "Authorization": this.data.fullToken,
                    "UID": this.data.currentMachineID,
                    "SecretClientAccessKey": resoniteKey
                }
            }
        );
        if (res.status !== 200){
            const errorBody = await res.text();
            await this.logger.log("ERROR", `Unexpected HTTP status when logging out (${res.status} ${res.statusText}): ${errorBody}`);
            throw new Error(`Unexpected HTTP status when logging out (${res.status} ${res.statusText}): ${errorBody}`);
        }
        
        this.data.loggedIn = false;
        this.data.fullToken = "";
        this.data.token = "";
        this.data.userId = "";
    }

    async start(){
        //Need to check if logged in
        if (!this.data.loggedIn){
            throw new Error("This bot isn't logged in!");
        }
        if (this.signalRConnection !== undefined){
            throw new Error("This bot has already been started!");
        }
        this.data.stopRequested = false;
        
        // Test network connectivity before starting SignalR
        await this.testNetworkConnectivity();
        
        await this.startSignalR();
        
        // Start auto functions immediately after SignalR connection
        await this.logger.log("INFO", "Starting automatic functions...");
        setTimeout(async () => {
            await this.logger.log("INFO", "Running initial friend accept check...");
            try {
                await this.runAutoFriendAccept();
            } catch (error) {
                await this.logger.log("ERROR", `Initial friend accept check failed: ${error.message}`);
            }
            await this.runStatusUpdate();
        }, 2000);
        
        // Set intervals for automatic functions with proper error handling
        this.autoRunners.autoAcceptFriendRequests = setInterval(async () => {
            try {
                await this.logger.log("DEBUG", "Running scheduled friend accept check...");
                await this.runAutoFriendAccept();
            } catch (error) {
                await this.logger.log("ERROR", `Scheduled friend accept check failed: ${error.message}`);
            }
        }, 10000); // 10 seconds - as requested by user
        
        this.autoRunners.updateStatus = setInterval(async () => {
            try {
                await this.runStatusUpdate();
            } catch (error) {
                await this.logger.log("ERROR", `Status update failed: ${error.message}`);
            }
        }, 90000);
        
        this.autoRunners.extendLogin = setInterval(async () => {
            try {
                await this.extendLogin();
            } catch (error) {
                await this.logger.log("ERROR", `Login extension failed: ${error.message}`);
            }
        }, 600000);
        
        await this.logger.log("INFO", "✅ Auto friend accept will check every 10 seconds");
        await this.logger.log("INFO", "✅ Status update will run every 90 seconds");
        await this.logger.log("INFO", "✅ Login extension will run every 10 minutes");
    }

    async testNetworkConnectivity() {
        try {
            await this.logger.log("INFO", "Testing network connectivity to Resonite API...");
            
            // Test basic connectivity to Resonite API
            const testResponse = await fetch(`${baseAPIURL}/`, {
                method: 'GET',
                signal: AbortSignal.timeout(10000)
            });
            
            await this.logger.log("INFO", `API connectivity test result: ${testResponse.status}`);
            
            // Test hub endpoint specifically
            const hubResponse = await fetch(`${baseAPIURL}/hub/negotiate`, {
                method: 'POST',
                headers: {
                    "Authorization": this.data.fullToken,
                    "Content-Type": "application/json"
                },
                signal: AbortSignal.timeout(15000)
            });
            
            await this.logger.log("INFO", `Hub negotiate test result: ${hubResponse.status}`);
            
            if (!hubResponse.ok) {
                const errorText = await hubResponse.text();
                await this.logger.log("WARNING", `Hub negotiate failed: ${errorText}`);
            }
            
        } catch (error) {
            await this.logger.log("WARNING", `Network connectivity test failed: ${error.message}`);
            // Don't throw error, just log warning - let SignalR handle the actual connection
        }
    }

    async stop(){
        this.data.stopRequested = true;
        if (this._reconnectTimer){
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = undefined;
        }
        if (this.signalRConnection === undefined){
            throw new Error("This bot hasn't been started yet, so cannot stop.");
        }
        try {
            await this.signalRConnection.stop();
        } catch (err) {
            await this.logger.log("WARNING", `Error while stopping SignalR: ${err.message}`);
        }
        clearInterval(this.autoRunners.autoAcceptFriendRequests);
        clearInterval(this.autoRunners.updateStatus);
        clearInterval(this.autoRunners.extendLogin);
        this.signalRConnection = undefined;
        this.setConnectionStatus("disconnected");
    }

    _scheduleReconnect() {
        if (this.data.stopRequested) return;
        if (this._reconnectTimer) return;

        this._reconnectAttempts += 1;
        // Exponential backoff capped at 5 minutes
        const delayMs = Math.min(5000 * Math.pow(2, this._reconnectAttempts - 1), 300000);

        this.logger.log("WARNING",
            `Scheduling manual SignalR reconnect in ${Math.round(delayMs / 1000)}s ` +
            `(attempt #${this._reconnectAttempts})`);

        this._reconnectTimer = setTimeout(async () => {
            this._reconnectTimer = undefined;
            try {
                await this._performReconnect();
            } catch (err) {
                await this.logger.log("ERROR", `Manual reconnect failed: ${err.message}`);
                this._scheduleReconnect();
            }
        }, delayMs);
    }

    async _performReconnect(forceRelogin = false) {
        if (this.data.stopRequested) return;
        if (this._reconnectInProgress) {
            await this.logger.log("DEBUG", "Reconnect already in progress; skipping duplicate call");
            return;
        }
        this._reconnectInProgress = true;
        try {
            await this.logger.log("INFO",
                `Performing manual reconnect (attempt #${this._reconnectAttempts}, forceRelogin=${forceRelogin})...`);

            // Tear down old SignalR connection if any
            if (this.signalRConnection) {
                try {
                    await this.signalRConnection.stop();
                } catch (err) {
                    await this.logger.log("DEBUG", `Old SignalR stop error (ignored): ${err.message}`);
                }
                this.signalRConnection = undefined;
            }

            // Re-login if forced (server rejected the session), or token is missing/near expiry
            const expiryMs = Date.parse(this.data.tokenExpiry);
            const tokenInvalid =
                forceRelogin ||
                !this.data.loggedIn ||
                !this.data.fullToken ||
                isNaN(expiryMs) ||
                expiryMs - 60000 < Date.now();

            if (tokenInvalid) {
                await this.logger.log("INFO", forceRelogin
                    ? "Server rejected the session; re-logging in before reconnect"
                    : "Token missing or near expiry; re-logging in before reconnect");
                this.data.loggedIn = false;
                await this.login();
            }

            await this.startSignalR();
            await this.logger.log("INFO", "Manual reconnect successful");
        } finally {
            this._reconnectInProgress = false;
        }
    }

    async runAutoFriendAccept() {
        const startTime = new Date().toISOString();
        await this.logger.log("DEBUG", `[${startTime}] Starting friend request check...`);
        
        let friendList = [];
        if (this.config.autoAcceptFriendRequests !== "none"){
            try {
                await this.logger.log("DEBUG", "Fetching contacts from Resonite API...");
                
                // Use the same fetch configuration as app.js (which works)
                const res = await fetch(`${baseAPIURL}/users/${this.data.userId}/contacts`, {
                    headers: {
                        "Authorization": this.data.fullToken,
                        "UID": this.data.currentMachineID,
                        "SecretClientAccessKey": resoniteKey
                    },
                    signal: AbortSignal.timeout(10000)
                });

                await this.logger.log("DEBUG", `API Response status: ${res.status}`);

                if (res.status === 403) {
                    await this.logger.log("WARNING", "Session token rejected (403). Forcing reconnect (re-login + SignalR restart)...");
                    try {
                        await this._performReconnect(true);
                        await this.logger.log("INFO", "Reconnect successful. Will retry friend check on next interval.");
                    } catch (reconnectError) {
                        await this.logger.log("ERROR", `Reconnect after 403 failed: ${reconnectError.message}`);
                    }
                    return;
                }

                if (res.ok) {
                    const friends = await res.json();
                    await this.logger.log("INFO", `✅ Found ${friends.length} total contacts`);
                    
                    // Log all contacts to see their status - focus on contactStatus (based on addFriend implementation)
                    for (const friend of friends) {
                        const contactStatus = friend.contactStatus;
                        const friendStatus = friend.friendStatus; // secondary check
                        
                        await this.logger.log("DEBUG", `Contact: ${friend.contactUsername || 'Unknown'} (${friend.id}) [contactStatus: ${contactStatus}, friendStatus: ${friendStatus}]`);
                        
                        // Based on research: check contactStatus for "Requested" (primary field used in Resonite API)
                        if (contactStatus === "Requested") {
                            friendList.push(friend);
                            await this.logger.log("INFO", `🔍 Found pending request from ${friend.contactUsername || friend.id} (contactStatus: Requested)`);
                        }
                    }
                    
                    if (friendList.length > 0) {
                        await this.logger.log("INFO", `🎯 Total pending friend requests: ${friendList.length}`);
                    } else {
                        await this.logger.log("DEBUG", "No pending friend requests found");
                    }
                } else {
                    const errorText = await res.text();
                    await this.logger.log("WARNING", `❌ API Error: ${res.status} ${res.statusText} - ${errorText}`);
                    return;
                }
            } catch (error) {
                await this.logger.log("ERROR", `❌ Network error during friend check: ${error.message}`);
                await this.logger.log("ERROR", `Error type: ${error.constructor.name}`);
                return;
            }
        } else {
            await this.logger.log("DEBUG", "Auto friend accept is disabled (config = none)");
            return;
        }

        if (this.config.autoAcceptFriendRequests === "list"){
            const beforeFilter = friendList.length;
            friendList = friendList.filter(friend => this.data.whitelist.includes(friend.id));
            await this.logger.log("DEBUG", `Whitelist filter: ${beforeFilter} -> ${friendList.length} requests`);
        }

        // Process friend requests using the correct format (based on addFriend method)
        if (friendList.length > 0) {
            await this.logger.log("INFO", `🎯 Processing ${friendList.length} friend request(s)...`);
            
            for (const friend of friendList) {
                try {
                    const friendName = friend.contactUsername || friend.id;
                    await this.logger.log("INFO", `👤 Processing request from: ${friendName}`);
                    
                    // Use the same format as addFriend method (research-based correction)
                    const acceptedFriend = {
                        "ownerId": this.data.userId,
                        "id": friend.id,
                        "contactUsername": friend.contactUsername,
                        "contactStatus": "Accepted"  // Only set contactStatus, not friendStatus
                    };
                    
                    await this.signalRConnection.send("UpdateContact", acceptedFriend);
                    await this.logger.log("INFO", `✅ Accepted friend request from ${friendName}`);
                    
                    // Send welcome message to new friend
                    try {
                        await this.sendTextMessage(friend.id, "フレンドを承認しました");
                        await this.logger.log("INFO", `📤 Sent welcome message to ${friendName}`);
                    } catch (messageError) {
                        await this.logger.log("WARNING", `📤❌ Failed to send welcome message to ${friendName}: ${messageError.message}`);
                    }
                    
                    this.emit("addedContact", friend.id);
                } catch (err) {
                    await this.logger.log("ERROR", `❌ Error accepting friend request from ${friend.id}: ${err}`);
                }
            }
        }
        
        const endTime = new Date().toISOString();
        await this.logger.log("DEBUG", `[${endTime}] Friend request check completed`);
    }

    async runStatusUpdate() {
        if (this.config.updateStatus){
            const statusUpdateData = {
                "userId": this.data.userId,
                "onlineStatus": "Online",
                "outputDevice": "Unknown",
                "sessionType": "Bot",
                "userSessionId": this.data.sessionId,
                "isPresent": true,
                "lastPresenceTimestamp": new Date(Date.now()).toISOString(),
                "lastStatusChange": new Date(Date.now()).toISOString(),
                "compatibilityHash": "mvcontactbot",
                "appVersion": this.config.versionName,
                "isMobile": false
            }

            const statusUpdateGroup = {
                "group": 1,
                "targetIds": null
            }

            //await this.logger.log("DEBUG", `Broadcasting Status: ${JSON.stringify(statusUpdateData)}`);
            await this.signalRConnection.send("BroadcastStatus", statusUpdateData, statusUpdateGroup)
            .catch((err) => {
                throw new Error(err);
            });
        }
    }

    async extendLogin() {
        if (this.config.autoExtendLogin){
            if ((Date.parse(this.data.tokenExpiry) - 600000) < Date.now()){
                try {
                    await this.logger.log("INFO", "Extending login");
                    const res = await fetch(`${baseAPIURL}/userSessions`,
                        {
                            method: "PATCH",
                            headers: {
                                "Authorization": this.data.fullToken,
                                "UID": this.data.currentMachineID,
                                "SecretClientAccessKey": resoniteKey
                            },
                            signal: AbortSignal.timeout(10000)
                        }
                    );
                    
                    if (res.ok){
                        this.data.tokenExpiry = (new Date(Date.now() + 8.64e+7)).toISOString();
                        await this.logger.log("INFO", "Successfully extended login session.");
                    }
                    else if (res.status === 403) {
                        await this.logger.log("WARNING", "Session token rejected during extend (403). Forcing reconnect...");
                        await this._performReconnect(true);
                        await this.logger.log("INFO", "Reconnect after token expiry successful.");
                    }
                    else{
                        const errorText = await res.text();
                        await this.logger.log("ERROR", `Couldn't extend login (${res.status} ${res.statusText}): ${errorText}`);
                    }
                } catch (error) {
                    await this.logger.log("WARNING", `Login extension failed due to network error: ${error.message}`);
                }
            }
        }
    }

    async startSignalR() {
        try {
            await this.logger.log("INFO", "Initializing SignalR connection...");
            
            //Connect to SignalR
            this.signalRConnection = new signalR.HubConnectionBuilder()
                .withUrl(`${baseAPIURL}/hub`, {
                    headers: {
                        "Authorization": this.data.fullToken,
                        "UID": this.data.currentMachineID,
                        "SecretClientAccessKey": resoniteKey
                    },
                    timeout: 60000, // Increase timeout to 60 seconds
                    transport: signalR.HttpTransportType.WebSockets | signalR.HttpTransportType.LongPolling // Allow fallback
                })
                .withAutomaticReconnect([0, 2000, 10000, 30000, 60000])
                .configureLogging(signalR.LogLevel.Critical) // Reduce logging to Critical to avoid spam
                .build();
        
            await this.logger.log("INFO", "Starting SignalR connection...");
            this.setConnectionStatus("connecting");
            
            // Add more detailed error handling for connection
            await this.signalRConnection.start().catch(async (err) => {
                await this.logger.log("ERROR", `SignalR start failed: ${err.message}`);
                this.setConnectionStatus("disconnected");
                
                // Try to diagnose the issue
                if (err.message.includes('fetch failed')) {
                    await this.logger.log("ERROR", "Network connectivity issue detected");
                } else if (err.message.includes('negotiation')) {
                    await this.logger.log("ERROR", "SignalR negotiation failed - possible authentication or server issue");
                }
                
                throw new Error(`SignalR connection failed: ${err.message}`);
            });
            
            await this.logger.log("INFO", "SignalR connection established successfully");
            this.setConnectionStatus("connected");
            this._reconnectAttempts = 0;
        
            // Add missing session update handler to prevent warnings
            this.signalRConnection.on("ReceiveSessionUpdate", async (sessionData) => {
                // Silently handle session updates without logging
            });
        
            //Actions whenever a message is received
            this.signalRConnection.on("ReceiveMessage", async (message) => {
                await this.logger.log("INFO", `Received ${message.messageType} message from ${message.senderId}: ${message.content}`);
                if (this.config.readMessagesOnReceive){
                    let readMessageData = {
                            "senderId": message.senderId,
                            "readTime": (new Date(Date.now())).toISOString(),
                            "ids": [
                                message.id
                            ]
                    }

                    await this.signalRConnection.send("MarkMessagesRead", readMessageData).catch(
                        async (reason) => {
                            await this.logger.log("ERROR", `Failed to mark message as read: ${reason}`);
                        }
                    );
                }
                
                this.emit("receiveRawMessage", message);
                
                // Handle OTP auto-reply
                if (message.messageType === "Text" && message.content.trim() === "OTP") {
                    try {
                        await this.sendTextMessage(message.senderId, "111222");
                        await this.logger.log("INFO", `🔐 Sent OTP response (111222) to ${message.senderId}`);
                    } catch (otpError) {
                        await this.logger.log("ERROR", `Failed to send OTP response: ${otpError.message}`);
                    }
                }
                
                switch (message.messageType){
                    case "Text":
                        this.emit("receiveTextMessage", message.senderId, message.content);
                        break;
                    case "Sound":
                        this.emit("receiveSoundMessage", message.senderId, `https://assets.resonite.com/${JSON.parse(message.content).assetUri.slice(9,74)}`);
                        break;
                    case "Object":
                        this.emit("receiveObjectMessage", message.senderId, JSON.parse(message.content).name, `https://assets.resonite.com/${JSON.parse(message.content).assetUri.slice(9,74)}`);
                        break;
                    case "SessionInvite":
                        this.emit("receiveSessionInviteMessage", message.senderId, JSON.parse(message.content).name, JSON.parse(message.content).sessionId);
                        break;
                    default:
                        await this.logger.log("WARNING", "Couldn't find a message type match!");
                }
            });
        
            this.signalRConnection.on("MessageSent", async (data) => {
                await this.logger.log("INFO", `Sent ${data.messageType} message to ${data.recipientId}: ${data.content}`);
            });
            
            // Add connection state logging
            this.signalRConnection.onreconnecting(() => {
                this.logger.log("WARNING", "SignalR reconnecting...");
                this.setConnectionStatus("reconnecting");
            });
            
            this.signalRConnection.onreconnected(() => {
                this.logger.log("INFO", "SignalR reconnected successfully");
                this.setConnectionStatus("connected");
                this._reconnectAttempts = 0;
            });
            
            this.signalRConnection.onclose((error) => {
                const errMsg = error?.message || error || 'No error specified';
                this.logger.log("WARNING", `SignalR connection closed: ${errMsg}`);
                this.setConnectionStatus("disconnected");
                if (!this.data.stopRequested) {
                    this._scheduleReconnect();
                }
            });
            
        } catch (error) {
            await this.logger.log("ERROR", `SignalR initialization failed: ${error.message}`);
            throw error;
        }
    }

    async removeFriend(friendId){
        const res = await fetch(`${baseAPIURL}/users/${this.data.userId}/contacts`,
        {
            headers: {
                "Authorization": this.data.fullToken,
                "UID": this.data.currentMachineID,
                "SecretClientAccessKey": resoniteKey
            }
        });
        const resData = await res.json();
        let friendToRemove = resData.find(friend => friend.id == friendId);
        friendToRemove.contactStatus = "Ignored";

        await this.signalRConnection.send("UpdateContact", friendToRemove)
        .catch(async (err) => {
            await this.logger.log("ERROR", `Couldn't remove contact: ${err}`);
            throw new Error(`Couldn't remove contact: ${err}`);
        });

        if (res.status !== 200){
            this.logger.log("ERROR", `Unexpected error when trying to remove ${friendId}: ${res.status} ${res.statusText}${res.bodyUsed ? ': ' + res.body : '.'}`);
            throw new Error(`Unexpected error when trying to remove ${friendId}: ${res.status} ${res.statusText}${res.bodyUsed ? ': ' + res.body : '.'}`);
        }
    }

    /**
     * 指定ユーザーがBotと相互フレンド状態か確認する
     * Resoniteの Contact.CanBeInteractedWith と同等の判定を行う。
     * contactStatus は自分側の状態しか表さないため、addFriend 送信直後は
     * 相手未承認でも "Accepted" になり得る。isAccepted は双方向で受諾されて
     * 初めて true になるので、こちらを一次判定に使う。
     * @param {string} userId 対象のResoniteユーザーID
     * @returns {Promise<boolean>} 相互フレンドなら true
     */
    async isFriendWith(userId){
        const res = await fetch(`${baseAPIURL}/users/${this.data.userId}/contacts`, {
            headers: {
                "Authorization": this.data.fullToken,
                "UID": this.data.currentMachineID,
                "SecretClientAccessKey": resoniteKey
            },
            signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(`Failed to fetch contacts (${res.status} ${res.statusText}): ${body}`);
        }
        const contacts = await res.json();
        const contact = contacts.find(c => c.id === userId);
        if (!contact) return false;
        if (contact.isAccepted !== true) return false;
        const isPartiallyMigrated = contact.isMigrated === true && contact.isCounterpartMigrated !== true;
        if (isPartiallyMigrated) return false;
        return true;
    }

    async addFriend(friendId){
        const res = await fetch(`${baseAPIURL}/users/${friendId}`);
        const resData = await res.json();
        const requestedFriend = {
            "ownerId": this.data.userId,
            "id": friendId,
            "contactUsername": resData.username,
            "contactStatus": "Accepted"
        };

        await this.signalRConnection.send("UpdateContact", requestedFriend)
        .catch(async (err) => {
            await this.logger.log("ERROR", `Couldn't add contact: ${err}`);
            throw new Error(`Couldn't add contact: ${err}`);
        });
    }

    async sendRawMessage(messageData){
        await this.signalRConnection.send("SendMessage", messageData)
        .catch(async (err) => {
            await this.logger.log("ERROR", `Couldn't send message: ${err}`);
            throw new Error(`Couldn't send message: ${err}`);
        });
    }

    async sendTextMessage(recipientUser, textMessage){
        const messageData = {
            "id": `MSG-${randomUUID()}`,
            "senderId": this.data.userId,
            "recipientId": recipientUser,
            "messageType": "Text",
            "sendTime": (new Date(Date.now())).toISOString(),
            "lastUpdateTime": (new Date(Date.now())).toISOString(),
            "content": textMessage
        }

        await this.signalRConnection.send("SendMessage", messageData)
        .catch(async (err) => {
            await this.logger.log("ERROR", `Couldn't send message: ${err}`);
            throw new Error(`Couldn't send message: ${err}`);
        });
    }
}

function GenerateRandomMachineId(){
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_';
    for (let i = 0; i < 128; i++){
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

function GenerateUID(){
    let result = '';
    const data = `mvcontact-bot-${randomBytes(16).toString('base64')}`;
    result = createHash('sha256').update(data).digest('hex').toUpperCase();
    return result;
}

module.exports = {MVContactBot};    