/*
Name: Brice Blanchard
Date: 3/17/2025
Project: Nellis Auction Refund Handler
Version: 3.0
*/

import { STATE } from './constants.js';

/**
 * Manages the extension state with storage integration
 */
export class StateManager {
    constructor(logger) {
        this.logger = logger;
        this.extensionState = STATE.NOT_RUNNING;
        this.processingPaused = false;
        
        // Initialize from storage
        this._initFromStorage();
    }
    
    /**
     * Initialize state from storage
     */
    async _initFromStorage() {
        try {
            const data = await new Promise(resolve => {
                chrome.storage.local.get(['extensionState', 'processingPaused'], resolve);
            });
            
            if (data.extensionState) {
                this.extensionState = data.extensionState;
                this.logger.debug(`Initialized state from storage: ${this.extensionState}`);
            }
            
            if (data.processingPaused !== undefined) {
                this.processingPaused = data.processingPaused;
            }
        } catch (error) {
            this.logger.error('Failed to initialize state from storage:', error);
        }
    }
    
    /**
     * Set the extension state and notify background script
     */
    setState(newState) {
        // Only notify if the state is changing
        if (this.extensionState !== newState) {
            this.extensionState = newState;
            this.logger.info(`State changed to: ${newState}`);
            
            // Notify background script of state change
            chrome.runtime.sendMessage({
                action: "stateChanged",
                state: newState
            });
            
            // Update in storage
            chrome.storage.local.set({ extensionState: newState });
        }
    }
    
    /**
     * Get the current extension state
     */
    getState() {
        return this.extensionState;
    }
    
    /**
     * Set the processing paused flag
     */
    setPaused(isPaused) {
        this.processingPaused = isPaused;
        chrome.storage.local.set({ processingPaused: isPaused });
        this.logger.debug(`Processing paused set to: ${isPaused}`);
    }
    
    /**
     * Check if processing is paused
     */
    isPaused() {
        return this.processingPaused;
    }
    
    /**
     * Check if the extension is in a running state
     */
    isRunning() {
        return this.extensionState === STATE.RUNNING && !this.processingPaused;
    }
    
    /**
     * Reset the state manager to initial values
     */
    reset() {
        this.setState(STATE.NOT_RUNNING);
        this.setPaused(false);
    }
    
    /**
     * Save a recovery target for handling retries and redirects
     */
    async saveRecoveryTarget(action, data) {
        const recoveryTarget = {
            action,
            ...data
        };
        
        this.logger.debug(`Saving recovery target`, recoveryTarget);
        
        await new Promise(resolve => {
            chrome.storage.local.set({
                extensionState: STATE.RETRYING,
                recoveryTarget
            }, resolve);
        });
        
        this.setState(STATE.RETRYING);
        
        return recoveryTarget;
    }
    
    /**
     * Clear any recovery target
     */
    async clearRecoveryTarget() {
        await new Promise(resolve => {
            chrome.storage.local.remove(['recoveryTarget'], resolve);
        });
        
        this.logger.debug('Recovery target cleared');
    }
    
    /**
     * Get the current recovery target if any
     */
    async getRecoveryTarget() {
        const data = await new Promise(resolve => {
            chrome.storage.local.get(['recoveryTarget'], resolve);
        });
        
        return data.recoveryTarget;
    }
}