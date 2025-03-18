/*
Name: Brice Blanchard
Date: 3/17/2025
Project: Nellis Auction Refund Handler
Version: 3.0
*/

import { STATE } from './constants.js';

/**
 * Monitors the heartbeat of the refund processing
 */
export class HeartbeatMonitor {
    constructor(logger, config, errorHandler) {
        this.logger = logger;
        this.config = config;
        this.errorHandler = errorHandler;
        this.interval = null;
        this.lastActivityTimestamp = Date.now();
    }
    
    /**
     * Start the heartbeat monitor
     */
    start() {
        this.stop(); // Clear any existing interval
        this.lastActivityTimestamp = Date.now();
        
        this.interval = setInterval(() => {
            this.checkHeartbeat();
        }, this.config.heartbeatInterval);
        
        this.logger.debug(`Heartbeat monitor started with interval ${this.config.heartbeatInterval}ms`);
    }
    
    /**
     * Stop the heartbeat monitor
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
            this.logger.debug('Heartbeat monitor stopped');
        }
    }
    
    /**
     * Check the heartbeat
     */
    checkHeartbeat() {
        // Get the current state
        chrome.storage.local.get(['extensionState'], (result) => {
            // Only check if we're supposed to be running
            if (result.extensionState !== STATE.RUNNING) {
                this.stop();
                return;
            }
            
            const now = Date.now();
            const timeSinceLastActivity = now - this.lastActivityTimestamp;
            
            // If no activity for longer than our initial timeout, trigger a recovery
            if (timeSinceLastActivity > this.config.initialTimeout) {
                this.logger.warn(`Heartbeat detected inactivity for ${timeSinceLastActivity}ms, triggering recovery`);
                this.errorHandler.recoverFromStall();
            }
        });
    }
    
    /**
     * Record activity to prevent false heartbeat triggers
     */
    recordActivity() {
        this.lastActivityTimestamp = Date.now();
        return this.lastActivityTimestamp;
    }
    
    /**
     * Get the timestamp of the last activity
     */
    getLastActivityTimestamp() {
        return this.lastActivityTimestamp;
    }
    
    /**
     * Set the last activity timestamp
     */
    setLastActivityTimestamp(timestamp) {
        this.lastActivityTimestamp = timestamp;
    }
}