/*
Name: Brice Blanchard
Date: 3/17/2025
Project: Nellis Auction Refund Handler
Version: 3.0
*/

// Global State Management constants
export const STATE = {
    NOT_RUNNING: 'notRunning',
    RUNNING: 'running',
    PAUSED: 'paused',
    RETRYING: 'retrying'
};

// Log levels
export const LOG_LEVEL = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

// Default configuration
export const DEFAULT_CONFIG = {
    initialTimeout: 30000,
    retryTimeout: 10000,
    extendedTimeout: 20000,
    maxRetries: 3,
    heartbeatInterval: 5000,
    redirectURL: "https://cargo.nellisauction.com/operations/returns?tab=awaitingProcessing"
};

// Config class to handle configuration management
export class Config {
    constructor(configObject = {}) {
        this.initialTimeout = configObject.initialTimeout || DEFAULT_CONFIG.initialTimeout;
        this.retryTimeout = configObject.retryTimeout || DEFAULT_CONFIG.retryTimeout;
        this.extendedTimeout = configObject.extendedTimeout || DEFAULT_CONFIG.extendedTimeout;
        this.maxRetries = configObject.maxRetries || DEFAULT_CONFIG.maxRetries;
        this.heartbeatInterval = configObject.heartbeatInterval || DEFAULT_CONFIG.heartbeatInterval;
        this.redirectURL = DEFAULT_CONFIG.redirectURL;
        this.refundLimit = 500;
        this.refundsToProcess = 200;
    }

    updateFromObject(configObject) {
        Object.assign(this, {
            ...this, // Keep existing values
            ...configObject // Override with new values
        });
    }

    // Save configuration to storage
    async saveToStorage() {
        return new Promise((resolve) => {
            chrome.storage.local.set({
                initialTimeout: this.initialTimeout,
                retryTimeout: this.retryTimeout,
                extendedTimeout: this.extendedTimeout,
                maxRetries: this.maxRetries,
                heartbeatInterval: this.heartbeatInterval,
                refundLimit: this.refundLimit,
                refundsToProcess: this.refundsToProcess
            }, resolve);
        });
    }

    // Load configuration from storage
    async loadFromStorage() {
        return new Promise((resolve) => {
            chrome.storage.local.get([
                'initialTimeout',
                'retryTimeout',
                'extendedTimeout',
                'maxRetries',
                'heartbeatInterval',
                'refundLimit',
                'refundsToProcess'
            ], (data) => {
                this.updateFromObject(data);
                resolve(this);
            });
        });
    }
}