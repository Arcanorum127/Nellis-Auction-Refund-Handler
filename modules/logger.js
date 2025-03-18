/*
Name: Brice Blanchard
Date: 3/17/2025
Project: Nellis Auction Refund Handler
Version: 3.0
*/

import { LOG_LEVEL } from './constants.js';

/**
 * Enhanced logging system for the Nellis Auction Refund Handler
 */
export class Logger {
    constructor(options = {}) {
        this.level = this._parseLogLevel(options.logLevel || 'info');
        this.enableConsoleOutput = options.enableConsoleOutput !== false;
        this.enableStorageOutput = options.enableStorageOutput !== false;
        this.maxLogEntries = options.maxLogEntries || 1000;
        this.logs = [];
        
        // Initialize logs from storage if enabled
        if (this.enableStorageOutput) {
            this._initFromStorage();
        }
    }
    
    /**
     * Convert string log level to numeric value
     */
    _parseLogLevel(level) {
        if (typeof level === 'number') {
            return level;
        }
        
        switch (level.toLowerCase()) {
            case 'debug': return LOG_LEVEL.DEBUG;
            case 'info': return LOG_LEVEL.INFO;
            case 'warn': return LOG_LEVEL.WARN;
            case 'error': return LOG_LEVEL.ERROR;
            default: return LOG_LEVEL.INFO;
        }
    }
    
    /**
     * Initialize logs from storage
     */
    async _initFromStorage() {
        try {
            const data = await new Promise(resolve => {
                chrome.storage.local.get(['logs'], resolve);
            });
            
            if (data.logs && Array.isArray(data.logs)) {
                this.logs = data.logs;
                // Ensure we don't exceed max entries
                if (this.logs.length > this.maxLogEntries) {
                    this.logs = this.logs.slice(-this.maxLogEntries);
                }
            }
        } catch (error) {
            console.error('Failed to initialize logs from storage:', error);
        }
    }
    
    /**
     * Save logs to storage
     */
    async _saveToStorage() {
        if (!this.enableStorageOutput) return;
        
        try {
            await new Promise(resolve => {
                chrome.storage.local.set({ logs: this.logs.slice(-this.maxLogEntries) }, resolve);
            });
        } catch (error) {
            console.error('Failed to save logs to storage:', error);
        }
    }
    
    /**
     * Create a log entry
     */
    _createLogEntry(level, message, data) {
        return {
            timestamp: new Date().toISOString(),
            level,
            message,
            data: data || null
        };
    }
    
    /**
     * Add a log entry and handle outputs
     */
    _log(level, levelName, message, data) {
        if (level < this.level) return;
        
        const entry = this._createLogEntry(levelName, message, data);
        
        // Add to in-memory logs
        this.logs.push(entry);
        
        // Trim if exceeds max entries
        if (this.logs.length > this.maxLogEntries) {
            this.logs.shift();
        }
        
        // Console output
        if (this.enableConsoleOutput) {
            const consoleMethod = levelName.toLowerCase();
            if (data) {
                console[consoleMethod](`[${new Date().toLocaleTimeString()}] [${levelName}] ${message}`, data);
            } else {
                console[consoleMethod](`[${new Date().toLocaleTimeString()}] [${levelName}] ${message}`);
            }
        }
        
        // Storage output - use debouncing to avoid excessive writes
        if (this.enableStorageOutput) {
            if (this._saveTimeout) {
                clearTimeout(this._saveTimeout);
            }
            
            this._saveTimeout = setTimeout(() => {
                this._saveToStorage();
            }, 1000);
        }
        
        return entry;
    }
    
    /**
     * Log a debug message
     */
    debug(message, data) {
        return this._log(LOG_LEVEL.DEBUG, 'DEBUG', message, data);
    }
    
    /**
     * Log an info message
     */
    info(message, data) {
        return this._log(LOG_LEVEL.INFO, 'INFO', message, data);
    }
    
    /**
     * Log a warning message
     */
    warn(message, data) {
        return this._log(LOG_LEVEL.WARN, 'WARN', message, data);
    }
    
    /**
     * Log an error message
     */
    error(message, data) {
        return this._log(LOG_LEVEL.ERROR, 'ERROR', message, data);
    }
    
    /**
     * Get recent logs
     */
    getRecentLogs(count = this.maxLogEntries) {
        return this.logs.slice(-count);
    }
    
    /**
     * Filter logs by level
     */
    getLogsByLevel(level, count = this.maxLogEntries) {
        const levelName = typeof level === 'number' ? 
            Object.keys(LOG_LEVEL).find(key => LOG_LEVEL[key] === level) : 
            level.toUpperCase();
            
        return this.logs
            .filter(entry => entry.level === levelName)
            .slice(-count);
    }
    
    /**
     * Get logs for a specific time range
     */
    getLogsInTimeRange(startTime, endTime, count = this.maxLogEntries) {
        return this.logs
            .filter(entry => {
                const timestamp = new Date(entry.timestamp).getTime();
                return timestamp >= startTime && timestamp <= endTime;
            })
            .slice(-count);
    }
    
    /**
     * Search logs by text
     */
    searchLogs(text, count = this.maxLogEntries) {
        if (!text) return this.getRecentLogs(count);
        
        const searchTerms = text.toLowerCase().split(' ');
        
        return this.logs
            .filter(entry => {
                const entryText = (entry.message + ' ' + JSON.stringify(entry.data)).toLowerCase();
                return searchTerms.every(term => entryText.includes(term));
            })
            .slice(-count);
    }
    
    /**
     * Clear all logs
     */
    async clearLogs() {
        this.logs = [];
        
        if (this.enableStorageOutput) {
            try {
                await new Promise(resolve => {
                    chrome.storage.local.remove(['logs'], resolve);
                });
            } catch (error) {
                console.error('Failed to clear logs in storage:', error);
            }
        }
    }
    
    /**
     * Export logs to JSON
     */
    exportLogs() {
        return JSON.stringify(this.logs, null, 2);
    }
    
    /**
     * Set the current log level
     */
    setLogLevel(level) {
        this.level = this._parseLogLevel(level);
    }
}