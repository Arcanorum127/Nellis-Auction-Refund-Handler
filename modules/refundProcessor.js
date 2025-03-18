/*
Name: Brice Blanchard
Date: 3/17/2025
Project: Nellis Auction Refund Handler
Version: 3.0
*/

import { STATE } from './constants.js';

/**
 * Handles the core refund processing logic
 */
export class RefundProcessor {
    constructor(
        logger,
        stateManager,
        statisticsManager,
        navigationManager,
        errorHandler,
        heartbeatMonitor,
        config
    ) {
        this.logger = logger;
        this.stateManager = stateManager;
        this.statsManager = statisticsManager;
        this.navigationManager = navigationManager;
        this.errorHandler = errorHandler;
        this.heartbeatMonitor = heartbeatMonitor;
        this.config = config;
        
        // Set up bidirectional reference
        this.errorHandler.setRefundProcessor(this);
        
        // Processing state
        this.currentIteration = 0;
        this.refundsToProcess = 0;
        this.timeoutID = null;
        
        // Register for injected functions from ErrorHandler
        this.resetTimeout = this.resetTimeout.bind(this);
        this.continueProcessing = this.continueProcessing.bind(this);
    }
    
    /**
     * Initialize with recovery from previous state
     */
    async initializeWithRecovery() {
        // Initialize statistics
        await this.statsManager._initFromStorage();
        
        // Check for any pending timeouts or redirects
        this.restoreTimeoutIfNeeded();
        this.restoreRedirectStateIfNeeded();
        
        // Then check for normal session recovery
        chrome.storage.local.get(['extensionState', 'recoveryTarget', 'currentProgress', 'statistics'], (result) => {
            // Recover from previous state if needed
            if (result.extensionState === STATE.RETRYING && result.recoveryTarget) {
                this.logger.info("Recovering from interrupted retry/redirect");
                this.stateManager.setState(STATE.RUNNING);
                
                // Set appropriate state based on recovery target
                if (result.recoveryTarget.action === 'skip') {
                    this.currentIteration = result.recoveryTarget.iteration;
                    this.errorHandler.setSkipCurrentRefund(false);
                    this.errorHandler.setRetryCount(0);
                } else if (result.recoveryTarget.action === 'retry') {
                    this.currentIteration = result.recoveryTarget.iteration;
                    this.errorHandler.setRetryCount(result.recoveryTarget.retryCount);
                }
                
                // Clear recovery target
                chrome.storage.local.remove(['recoveryTarget']);
                
                // Set proper processing state
                if (result.currentProgress) {
                    this.refundsToProcess = result.currentProgress.total;
                }
                
                // Restore statistics
                if (result.statistics) {
                    Object.assign(this.statsManager.statistics, result.statistics);
                }
                
                // Notify background script of state change
                chrome.runtime.sendMessage({
                    action: "stateChanged",
                    state: STATE.RUNNING
                });
                
                // Start processing again with appropriate timeout
                this.resetTimeout();
                this.heartbeatMonitor.start();
                this.errorHandler.startMonitoring();
                this.continueProcessing();
            }
            // Otherwise normal initialization
            else if (result.extensionState === STATE.RUNNING || result.extensionState === STATE.PAUSED) {
                this.logger.info("Resuming previous session");
                
                this.stateManager.setState(result.extensionState);
                if (result.currentProgress) {
                    this.currentIteration = result.currentProgress.current;
                    this.refundsToProcess = result.currentProgress.total;
                }
                
                if (result.statistics) {
                    Object.assign(this.statsManager.statistics, result.statistics);
                }
                
                // If we were running, restart the process
                if (this.stateManager.getState() === STATE.RUNNING) {
                    this.logger.info("Automatically resuming previous run");
                    
                    // Notify background script of state
                    chrome.runtime.sendMessage({
                        action: "stateChanged",
                        state: STATE.RUNNING
                    });
                    
                    this.resetTimeout();
                    this.heartbeatMonitor.start();
                    this.errorHandler.startMonitoring();
                    this.continueProcessing();
                } else if (this.stateManager.getState() === STATE.PAUSED) {
                    // Notify background script of state
                    chrome.runtime.sendMessage({
                        action: "stateChanged",
                        state: STATE.PAUSED
                    });
                }
            }
        });
    }
    
    /**
     * Restore timeout after a page reload
     */
    restoreTimeoutIfNeeded() {
        chrome.storage.local.get(['timeoutInfo', 'extensionState'], (result) => {
            if (result.timeoutInfo && result.extensionState === STATE.RUNNING) {
                const now = Date.now();
                const elapsedTime = now - result.timeoutInfo.timeoutSet;
                
                // If original timeout hasn't expired yet, set a new one for remaining time
                if (elapsedTime < result.timeoutInfo.timeoutDuration) {
                    const remainingTime = result.timeoutInfo.timeoutDuration - elapsedTime;
                    this.logger.info(`Restoring timeout with ${remainingTime}ms remaining`);
                    
                    if (this.timeoutID) {
                        clearTimeout(this.timeoutID);
                    }
                    
                    this.timeoutID = setTimeout(() => {
                        this.errorHandler.recoverFromStall();
                    }, remainingTime);
                }
                // If original timeout would have expired, trigger recovery immediately
                else if (elapsedTime >= result.timeoutInfo.timeoutDuration) {
                    this.logger.warn("Timeout would have expired during page reload, triggering recovery");
                    
                    setTimeout(() => {
                        this.errorHandler.recoverFromStall();
                    }, 1000); // Small delay to let page initialize
                }
            }
        });
    }
    
    /**
     * Restore redirect state after a page reload
     */
    restoreRedirectStateIfNeeded() {
        chrome.storage.local.get(['redirectState'], (result) => {
            if (result.redirectState) {
                const now = Date.now();
                const redirectTime = result.redirectState.timestamp;
                const timeSinceRedirect = now - redirectTime;
                
                // Only restore if redirect was recent (within 30 seconds)
                if (timeSinceRedirect < 30000) {
                    this.logger.info("Restoring state after redirect");
                    
                    if (result.redirectState.redirectCount) {
                        this.navigationManager.setRedirectCount(result.redirectState.redirectCount);
                    }
                    
                    // Clear the saved redirect state
                    chrome.storage.local.remove(['redirectState']);
                    
                    // If we were running, restart processing
                    if (this.stateManager.getState() === STATE.RUNNING) {
                        setTimeout(() => {
                            this.resetTimeout();
                            this.continueProcessing();
                        }, 2000); // Small delay to let page render
                    }
                } else {
                    // Clear stale redirect state
                    chrome.storage.local.remove(['redirectState']);
                }
            }
        });
    }
    
    /**
     * Start processing refunds
     */
    startProcessing(iterations) {
        // Make sure we have the correct total
        this.refundsToProcess = iterations;
        this.currentIteration = 0;
        
        // Double-check and enforce limit from storage
        chrome.storage.local.get(['refundsToProcess'], (data) => {
            if (data.refundsToProcess) {
                // Store the correct value and use it for display and checking
                this.refundsToProcess = data.refundsToProcess;
                
                // Update progress in storage with corrected total
                chrome.storage.local.set({
                    currentProgress: {
                        current: this.currentIteration,
                        total: this.refundsToProcess
                    }
                });
            }
        });
        
        // Start the refund process
        this.runRefundProcess(iterations);
    }
    
    /**
     * Run the refund process for a specified number of iterations
     */
    async runRefundProcess(iterations) {
        // Make sure we have the correct total
        this.refundsToProcess = iterations;
        
        for (let i = 0; i < iterations; i++) {
            // CRITICAL: Double-check we haven't exceeded the total refunds to process
            if (this.currentIteration >= this.refundsToProcess) {
                this.logger.info(`Reached maximum number of refunds to process (${this.refundsToProcess}). Stopping.`);
                
                // Update state to no longer running
                this.stateManager.setState(STATE.NOT_RUNNING);
                
                // Notify background script of state change
                chrome.runtime.sendMessage({
                    action: "stateChanged",
                    state: STATE.NOT_RUNNING
                });
                
                // Update final statistics
                this.statsManager.updateStatistics('end');
                
                // Send completion notification
                chrome.runtime.sendMessage({
                    action: "processingComplete",
                    statistics: this.statsManager.getSummary()
                });
                
                chrome.storage.local.set({ extensionState: STATE.NOT_RUNNING });
                break;
            }
            
            // Check if processing has been paused or stopped
            if (this.stateManager.isPaused() || this.stateManager.getState() !== STATE.RUNNING) {
                this.logger.info("Processing paused or stopped");
                break;
            }
            
            this.resetTimeout();
            this.logger.info(`Starting iteration: ${this.currentIteration + 1}`);
            
            // Execute refund sequence and handle result
            const success = await this.executeRefundSequence(this.currentIteration);
            
            // Only increment if the process wasn't paused or stopped
            if (!this.stateManager.isPaused() && this.stateManager.getState() === STATE.RUNNING) {
                this.currentIteration++;
                
                // IMPORTANT: Update progress in storage BEFORE continuing
                await new Promise(resolve => {
                    chrome.storage.local.set({
                        currentProgress: {
                            current: this.currentIteration,
                            total: this.refundsToProcess
                        }
                    }, resolve);
                });
                
                // Send progress update
                chrome.runtime.sendMessage({
                    action: "progressUpdate",
                    progress: {
                        current: this.currentIteration,
                        total: this.refundsToProcess
                    },
                    statistics: this.statsManager.getSummary()
                });
                
                this.logger.info(`Completed iteration: ${this.currentIteration}`);
                
                // Add delay between iterations to avoid overloading
                await this.navigationManager.waitFor(350);
                
                // ADDED SAFETY CHECK: Break if we've reached the limit
                if (this.currentIteration >= this.refundsToProcess) {
                    this.logger.info(`Reached limit of ${this.refundsToProcess} refunds. Stopping.`);
                    break;
                }
                
                // If the sequence failed but we haven't hit retry limit
                if (!success && this.errorHandler.getRetryCount() < this.config.maxRetries) {
                    this.logger.warn(`Refund sequence failed, attempting retry #${this.errorHandler.getRetryCount() + 1}`);
                    i--; // Retry this iteration
                    this.errorHandler.recoverFromStall();
                    break; // Break the loop, retry will restart it
                }
            }
        }
        
        // If we've completed all iterations and weren't paused/stopped
        if (this.currentIteration >= this.refundsToProcess && 
            !this.stateManager.isPaused() && 
            this.stateManager.getState() === STATE.RUNNING) {
            
            this.logger.info('All iterations completed!');
            this.stateManager.setState(STATE.NOT_RUNNING);
            
            // Notify background script of state change
            chrome.runtime.sendMessage({
                action: "stateChanged",
                state: STATE.NOT_RUNNING
            });
            
            // Update final statistics
            this.statsManager.updateStatistics('end');
            
            // Send completion notification
            chrome.runtime.sendMessage({
                action: "processingComplete",
                statistics: this.statsManager.getSummary()
            });
            
            chrome.storage.local.set({ extensionState: STATE.NOT_RUNNING });
            
            // Show desktop notification if possible
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Refund Processing Complete', {
                    body: `Successfully processed ${this.statsManager.statistics.successful} refunds`
                });
            }
        }
    }
    
    /**
     * Continue processing refunds from the current position
     */
    continueProcessing() {
        this.logger.info(`Resuming from iteration: ${this.currentIteration + 1}`);
        this.heartbeatMonitor.recordActivity(); // Record this as activity for heartbeat
        
        // Get correct refund count from storage before continuing
        chrome.storage.local.get(['refundsToProcess', 'currentProgress'], (data) => {
            if (data.refundsToProcess) {
                // Make sure we have the correct total
                this.refundsToProcess = data.refundsToProcess;
                
                // Double check current iteration from stored progress
                if (data.currentProgress && data.currentProgress.current !== undefined) {
                    this.currentIteration = data.currentProgress.current;
                }
                
                // CRITICAL: Check if we've already reached the limit
                if (this.currentIteration >= this.refundsToProcess) {
                    this.logger.warn(`Cannot continue: already reached limit of ${this.refundsToProcess} refunds.`);
                    
                    // Update state to not running
                    this.stateManager.setState(STATE.NOT_RUNNING);
                    
                    // Notify background script of state change
                    chrome.runtime.sendMessage({
                        action: "stateChanged",
                        state: STATE.NOT_RUNNING
                    });
                    
                    // Update final statistics
                    this.statsManager.updateStatistics('end');
                    
                    // Send completion notification
                    chrome.runtime.sendMessage({
                        action: "processingComplete",
                        statistics: this.statsManager.getSummary()
                    });
                    
                    chrome.storage.local.set({ extensionState: STATE.NOT_RUNNING });
                    return;
                }
                
                // Calculate remaining refunds
                const remainingRefunds = this.refundsToProcess - this.currentIteration;
                
                this.logger.info(`Continuing with ${remainingRefunds} refunds remaining to process (total: ${this.refundsToProcess})`);
                
                // Run the refund process with the correct remaining count
                this.runRefundProcess(remainingRefunds);
            } else {
                // If we don't have stored refundsToProcess, use what we have locally
                this.logger.info(`No stored refundsToProcess found, using local value: ${this.refundsToProcess}`);
                const remainingRefunds = this.refundsToProcess - this.currentIteration;
                this.runRefundProcess(remainingRefunds);
            }
        });
    }
    
    /**
     * Execute a single refund sequence
     */
    async executeRefundSequence(n) {
        const sequenceStartTime = Date.now();
        let refundDetails = { refundId: `refund-${this.currentIteration}`, amount: 0 };
        
        try {
            // Check if processing has been paused or stopped
            if (this.stateManager.isPaused() || this.stateManager.getState() !== STATE.RUNNING) {
                this.logger.info("Processing paused or stopped during sequence execution");
                return false;
            }
            
            // First run doesn't need to wait for elements since we're already on the page
            if (n !== 0) {
                try {
                    await this.navigationManager.waitForElement('.teal.item.tw-flex.tw-w-full.tw-justify-between', 10000);
                } catch (error) {
                    this.logger.error("Timeout waiting for refund page navigation elements");
                    return false;
                }
            }
            
            this.logger.info(`Processing refund: ${this.currentIteration + 1}`);
            if (!this.navigationManager.toAwaitingRefunds()) {
                return false;
            }
            
            // Wait for refund buttons to appear
            try {
                await this.navigationManager.waitForElement('.ui.fluid.button.ui.basic.label', 10000);
            } catch (error) {
                this.logger.error("Timeout waiting for refund buttons");
                return false;
            }
            
            if (!this.navigationManager.beginAwaitingRefunds(
                    n, 
                    this.navigationManager.getRedirectCount(), 
                    this.errorHandler.shouldSkipCurrentRefund()
                )) {
                return false;
            }
            
            try {
                await this.navigationManager.waitForElement('.ui.teal.tiny.label.tw-ml-2', 10000);
            } catch (error) {
                this.logger.error("Timeout waiting for refund details");
                return false;
            }
            
            await this.navigationManager.waitFor(1500);
            
            // Check again if processing has been paused or stopped
            if (this.stateManager.isPaused() || this.stateManager.getState() !== STATE.RUNNING) {
                return false;
            }
            
            // Check for any error messages on the page
            const errorElements = document.querySelectorAll(".ui.red.tiny.compact.message");
            if (errorElements.length > 0) {
                this.logger.warn("Error message detected on page:", errorElements[0].textContent);
                this.errorHandler.handleErrorDetected(errorElements[0].textContent);
                return false;
            }
            
            // Get refund details for tracking
            refundDetails = this.getRefundDetails();
            
            // This code runs through the refunds and will repeat if there are multiple refunds for one customer
            const refundSteps = document.querySelector('.ui.small.fluid.vertical.steps');
            if (!refundSteps) {
                this.logger.error("Could not find refund steps");
                return false;
            }
            
            const refundsNum = refundSteps.querySelectorAll('a').length;
            
            for (let ii = 0; ii < refundsNum; ii++) {
                // Check if processing has been paused or stopped
                if (this.stateManager.isPaused() || this.stateManager.getState() !== STATE.RUNNING) {
                    return false;
                }
                
                // This code is for determining if the refund is over the limit, if it is, the refund is skipped
                const refundAmount = document.querySelector('.sub.header')?.textContent.trim();
                if (refundAmount) {
                    // Improved regex to properly extract dollar amount, looking for numbers with optional decimal point
                    const match = refundAmount.match(/\$?(\d+(?:\.\d+)?)/);
                    if (match) {
                        const number = parseFloat(match[1]);
                        this.logger.info(`Detected refund amount: ${number}, limit: ${this.config.refundLimit}`);
                        
                        // Checking if the amount is over the refund limit
                        if (number >= this.config.refundLimit) {
                            this.logger.warn(`Refund amount (${number}) exceeds limit (${this.config.refundLimit})! Skipping Refund!`);
                            
                            // Clear any pending timeout
                            this.clearTimeout();
                            
                            // Update statistics with proper error message
                            this.statsManager.updateStatistics('skip', {
                                ...refundDetails,
                                amount: number,
                                errorMessage: `Refund amount (${number}) exceeds limit (${this.config.refundLimit})`,
                                processingTime: Date.now() - sequenceStartTime
                            });
                            
                            // Important: Set this flag to true to ensure the refund is skipped
                            this.errorHandler.setSkipCurrentRefund(true);
                            
                            // Reset retry counter since we're deliberately skipping
                            this.errorHandler.setRetryCount(0);
                            
                            // Move to next refund by incrementing currentIteration
                            const nextIteration = this.currentIteration + 1;
                            
                            // Send a message to notify the popup of the skip
                            chrome.runtime.sendMessage({
                                action: "progressUpdate",
                                progress: {
                                    current: nextIteration,
                                    total: this.refundsToProcess
                                },
                                statistics: this.statsManager.getSummary()
                            });
                            
                            // Save state before redirect
                            await this.stateManager.saveRecoveryTarget('skip', {
                                iteration: nextIteration,
                                errorMessage: `Refund amount (${number}) exceeds limit (${this.config.refundLimit})`
                            });
                            
                            // Redirect to main page to continue with next refund
                            this.logger.info(`Skip state saved, redirecting to ${this.config.redirectURL}`);
                            window.location.replace(this.config.redirectURL);
                            
                            // Set a backup timeout to force continue if redirect fails
                            this.timeoutID = setTimeout(() => {
                                this.logger.warn("Redirect timeout, forcing process to continue");
                                chrome.storage.local.get(['extensionState'], (result) => {
                                    if (result.extensionState === STATE.RETRYING) {
                                        this.stateManager.setState(STATE.RUNNING);
                                        this.currentIteration = nextIteration; // Skip to next refund
                                        this.resetTimeout();
                                        this.continueProcessing();
                                    }
                                });
                            }, 12000);
                            
                            return false;
                        }
                    }
                }
                
                // Check for any error messages before proceeding
                if (document.querySelector(".ui.red.tiny.compact.message")) {
                    const errorText = document.querySelector(".ui.red.tiny.compact.message").textContent;
                    this.logger.warn("Error message detected before refund initiation:", errorText);
                    this.errorHandler.handleErrorDetected(errorText);
                    return false;
                }
                
                if (!this.navigationManager.initiateSuggestedRefund()) {
                    return false;
                }
                
                // If the suggested method is original payment, yet there is only a store credit button, 
                // then fill store credit and proceed
                const refundAmountLeft = document.querySelector('.sub.header');
                
                try {
                    await this.navigationManager.waitForElement('.ui.green.tiny.button', 10000);
                } catch (error) {
                    this.logger.error("Timeout waiting for complete refund button");
                    return false;
                }
                
                // Check for any error messages before completing the refund
                if (document.querySelector(".ui.red.tiny.compact.message")) {
                    const errorText = document.querySelector(".ui.red.tiny.compact.message").textContent;
                    this.logger.warn("Error message detected before completing refund:", errorText);
                    this.errorHandler.handleErrorDetected(errorText);
                    return false;
                }
                
                if (!this.navigationManager.completeRefund()) {
                    return false;
                }
                
                try {
                    await this.navigationManager.waitForElement('button.ui.green.mini.button:has(i.checkmark.icon)', 10000);
                } catch (error) {
                    this.logger.error("Timeout waiting for finalize button");
                    return false;
                }
                
                // Check for any error messages before finalizing
                if (document.querySelector(".ui.red.tiny.compact.message")) {
                    const errorText = document.querySelector(".ui.red.tiny.compact.message").textContent;
                    this.logger.warn("Error message detected before finalizing:", errorText);
                    this.errorHandler.handleErrorDetected(errorText);
                    return false;
                }
                
                if (!this.navigationManager.finalizeRefund()) {
                    return false;
                }
                
                // Waiting long enough to determine if the payment amount has been met
                await this.navigationManager.waitFor(1300);
                
                // Check for any error messages after first refund attempt
                if (document.querySelector(".ui.red.tiny.compact.message")) {
                    const errorText = document.querySelector(".ui.red.tiny.compact.message").textContent;
                    this.logger.warn("Error message detected after first refund attempt:", errorText);
                    this.errorHandler.handleErrorDetected(errorText);
                    return false;
                }
                
                // If original payment method isn't enough, add store credit
                if (refundAmountLeft &&
                    refundAmountLeft.textContent.trim() !== "$0.00 remaining" &&
                    refundAmountLeft.textContent.includes('remaining')) {
                    
                    if (!this.navigationManager.storeCreditRefund()) {
                        return false;
                    }
                    
                    try {
                        await this.navigationManager.waitForElement('.ui.green.tiny.button', 10000);
                    } catch (error) {
                        this.logger.error("Timeout waiting for complete refund button (remainder)");
                        return false;
                    }
                    
                    // Check for any error messages before completing the remainder
                    if (document.querySelector(".ui.red.tiny.compact.message")) {
                        const errorText = document.querySelector(".ui.red.tiny.compact.message").textContent;
                        this.logger.warn("Error message detected before completing remainder:", errorText);
                        this.errorHandler.handleErrorDetected(errorText);
                        return false;
                    }
                    
                    if (!this.navigationManager.completeRefund()) {
                        return false;
                    }
                    
                    try {
                        await this.navigationManager.waitForElement('button.ui.green.mini.button:has(i.checkmark.icon)', 10000);
                    } catch (error) {
                        this.logger.error("Timeout waiting for finalize button (remainder)");
                        return false;
                    }
                    
                    // Check for any error messages before finalizing remainder
                    if (document.querySelector(".ui.red.tiny.compact.message")) {
                        const errorText = document.querySelector(".ui.red.tiny.compact.message").textContent;
                        this.logger.warn("Error message detected before finalizing remainder:", errorText);
                        this.errorHandler.handleErrorDetected(errorText);
                        return false;
                    }
                    
                    if (!this.navigationManager.finalizeRefund()) {
                        return false;
                    }
                    
                    // Check for any final error messages
                    if (document.querySelector(".ui.red.tiny.compact.message")) {
                        const errorText = document.querySelector(".ui.red.tiny.compact.message").textContent;
                        this.logger.warn("Error message detected after completing refund process:", errorText);
                        this.errorHandler.handleErrorDetected(errorText);
                        return false;
                    }
                }
            }
            
            // Calculate processing time for this refund
            const processingTime = Date.now() - sequenceStartTime;
            
            // Update statistics for successful refund
            this.statsManager.updateStatistics('success', {
                ...refundDetails,
                processingTime,
                retries: this.errorHandler.getRetryCount()
            });
            
            // Reset retry counter since we succeeded
            this.errorHandler.setRetryCount(0);
            
            // Update progress in storage
            chrome.storage.local.set({
                currentProgress: {
                    current: this.currentIteration + 1,
                    total: this.refundsToProcess
                }
            });
            
            return true;
        } catch (error) {
            this.logger.error(`Error in executeRefundSequence: ${error.message}`, error);
            
            // Update statistics for failed refund
            this.statsManager.updateStatistics('fail', {
                ...refundDetails,
                processingTime: Date.now() - sequenceStartTime,
                retries: this.errorHandler.getRetryCount(),
                errorMessage: error.message
            });
            
            return false;
        }
    }
    
    /**
     * Get refund details (ID, amount) for tracking
     */
    getRefundDetails() {
        try {
            // Try to get refund ID from appointment or element
            let refundId = '';
            const appointmentTitle = document.querySelector('.item[title]');
            if (appointmentTitle) {
                refundId = appointmentTitle.getAttribute('title');
            }
            
            // Try to get refund amount
            let refundAmount = 0;
            const amountText = document.querySelector('.sub.header')?.textContent.trim();
            if (amountText) {
                const match = amountText.match(/\$?(\d+(\.\d+)?)/);
                if (match) {
                    refundAmount = parseFloat(match[1]);
                }
            }
            
            return {
                refundId: refundId || `refund-${this.currentIteration}`,
                amount: refundAmount
            };
        } catch (error) {
            this.logger.error(`Error getting refund details: ${error.message}`);
            return {
                refundId: `refund-${this.currentIteration}`,
                amount: 0
            };
        }
    }
    
    /**
     * Reset the timeout with configurable duration
     */
    resetTimeout(timeoutDuration) {
        if (this.stateManager.getState() === STATE.RUNNING) {
            this.clearTimeout();
            
            const duration = timeoutDuration || this.config.initialTimeout;
            
            this.timeoutID = setTimeout(() => {
                this.errorHandler.recoverFromStall();
            }, duration);
            
            // Save the timeout info in case of page reload
            chrome.storage.local.set({
                timeoutInfo: {
                    timeoutSet: Date.now(),
                    timeoutDuration: duration
                }
            });
            
            this.logger.debug(`Timeout reset to ${duration}ms`);
        }
    }
    
    /**
     * Clear the timeout
     */
    clearTimeout() {
        if (this.timeoutID) {
            clearTimeout(this.timeoutID);
            this.timeoutID = null;
        }
    }
    
    /**
     * Stop processing completely
     */
    stopProcessing() {
        // Clear any pending timeouts
        this.clearTimeout();
        
        // Stop monitoring
        this.errorHandler.stopMonitoring();
        this.heartbeatMonitor.stop();
        
        // Reset all state variables
        this.stateManager.setState(STATE.NOT_RUNNING);
        this.stateManager.setPaused(false);
        this.navigationManager.setRedirectCount(0);
        
        // Update final statistics
        this.statsManager.updateStatistics('end');
        
        // Save state to storage
        chrome.storage.local.set({
            extensionState: STATE.NOT_RUNNING,
            currentProgress: null,
            statistics: this.statsManager.statistics
        });
        
        this.logger.info("Processing stopped completely");
    }
    
    /**
     * Get the current iteration
     */
    getCurrentIteration() {
        return this.currentIteration;
    }
    
    /**
     * Set the current iteration
     */
    setCurrentIteration(iteration) {
        this.currentIteration = iteration;
    }
    
    /**
     * Get the total refunds to process
     */
    getTotalRefunds() {
        return this.refundsToProcess;
    }
    
    /**
     * Get the progress object
     */
    getProgress() {
        return {
            current: this.currentIteration,
            total: this.refundsToProcess
        };
    }
    
    /**
     * Set skipCurrentRefund flag
     */
    setSkipCurrentRefund(skip) {
        this.errorHandler.setSkipCurrentRefund(skip);
    }
    
    /**
     * Set retry count
     */
    setRetryCount(count) {
        this.errorHandler.setRetryCount(count);
    }
    
    /**
     * Get the redirect URL
     */
    getRedirectURL() {
        return this.config.redirectURL;
    }
}