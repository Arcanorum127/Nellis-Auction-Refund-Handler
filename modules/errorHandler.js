/*
Name: Brice Blanchard
Date: 3/17/2025
Project: Nellis Auction Refund Handler
Version: 3.0
*/

import { STATE } from './constants.js';

/**
 * Handles error detection, recovery, and retries
 */
export class ErrorHandler {
    constructor(logger, stateManager, statisticsManager) {
        this.logger = logger;
        this.stateManager = stateManager;
        this.statsManager = statisticsManager;
        this.errorObserver = null;
        this.currentRetryCount = 0;
        this.skipCurrentRefund = false;
        this.timeoutID = null;
        this.redirectCount = 0;
    }
    
    /**
     * Start monitoring for error messages in the DOM
     */
    startMonitoring() {
        this.stopMonitoring(); // Ensure any existing observer is disconnected
        
        this.errorObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                    // Look for error message elements added to the DOM
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.checkForErrorMessage(node);
                        }
                    }
                }
            }
        });
        
        // Start observing the document body for error message additions
        this.errorObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
        
        this.logger.debug('Error monitoring started');
    }
    
    /**
     * Stop monitoring for error messages
     */
    stopMonitoring() {
        if (this.errorObserver) {
            this.errorObserver.disconnect();
            this.errorObserver = null;
            this.logger.debug('Error monitoring stopped');
        }
    }
    
    /**
     * Check if an element or its children contain an error message
     */
    checkForErrorMessage(element) {
        // Check if this element is an error message
        if (element.classList && element.classList.contains("ui") &&
            element.classList.contains("red") && element.classList.contains("message")) {
            this.logger.warn("Error message detected:", element.textContent);
            this.handleErrorDetected(element.textContent);
            return true;
        }
        
        // Check for the specific error message class
        const errorElement = element.querySelector(".ui.red.tiny.compact.message");
        if (errorElement) {
            this.logger.warn("Error message detected:", errorElement.textContent);
            this.handleErrorDetected(errorElement.textContent);
            return true;
        }
        
        return false;
    }
    
    /**
     * Handle a detected error message with improved recovery
     */
    async handleErrorDetected(errorText) {
        if (!this.stateManager.isRunning()) {
            return;
        }
        
        this.logger.warn(`Error detected: "${errorText}". Skipping current refund.`);
        
        // Clear any pending timeout
        if (this.timeoutID) {
            clearTimeout(this.timeoutID);
        }
        
        // Skip the current refund
        this.skipCurrentRefund = true;
        
        // Get refund details for tracking
        const refundDetails = this.getRefundDetails();
        
        // Update statistics
        this.statsManager.updateStatistics('skip', {
            ...refundDetails,
            errorMessage: errorText,
            processingTime: Date.now() - performance.now() // Approximation
        });
        
        // Reset retry counter since we're deliberately skipping
        this.currentRetryCount = 0;
        
        // Save state before redirect
        await this.stateManager.saveRecoveryTarget('skip', {
            iteration: this.getRefundPosition() + 1,
            errorMessage: errorText
        });
        
        // Redirect to main page and continue with next refund
        const redirectURL = this.getRedirectURL();
        this.logger.info(`Redirecting to ${redirectURL} to skip problematic refund`);
        location.replace(redirectURL);
        
        // Set a timer to check if we've loaded the new page
        this.timeoutID = setTimeout(() => {
            chrome.storage.local.get(['extensionState', 'recoveryTarget'], (result) => {
                if (result.extensionState === STATE.RETRYING) {
                    this.logger.warn("Error recovery redirect did not complete, attempting to force resume");
                    this.stateManager.setState(STATE.RUNNING);
                    this.continueProcessing(this.getRefundPosition() + 1); // Skip this problematic refund
                    
                    // Clear recovery state
                    chrome.storage.local.remove(['recoveryTarget']);
                }
            });
        }, 10000); // Allow 10 seconds for page to load
    }
    
    /**
     * Recover from a stall in processing
     */
    async recoverFromStall() {
        if (!this.stateManager.isRunning()) {
            return;
        }
        
        this.logger.warn(`Recovery attempt #${this.currentRetryCount + 1} initiated`);
        
        if (this.timeoutID) {
            clearTimeout(this.timeoutID);
        }
        
        // Get the config
        const config = await this.getConfig();
        
        // If we've retried too many times on this refund
        if (this.currentRetryCount >= config.maxRetries) {
            this.logger.warn(`Maximum retries (${config.maxRetries}) reached for current refund, skipping...`);
            this.skipCurrentRefund = true;
            
            const refundPosition = this.getRefundPosition();
            
            // Update statistics
            this.statsManager.updateStatistics('skip', {
                refundId: `refund-${refundPosition}`,
                retries: config.maxRetries
            });
            
            // Save state before redirect
            await this.stateManager.saveRecoveryTarget('skip', {
                iteration: refundPosition + 1
            });
            
            // Then redirect to main page
            const redirectURL = this.getRedirectURL();
            this.logger.info(`Redirecting to ${redirectURL} after max retries`);
            location.replace(redirectURL);
            
            // Set a timer to check if we've loaded the new page
            this.timeoutID = setTimeout(() => {
                chrome.storage.local.get(['extensionState', 'recoveryTarget'], (result) => {
                    if (result.extensionState === STATE.RETRYING) {
                        this.logger.warn("Recovery redirect did not complete, attempting to force resume");
                        this.stateManager.setState(STATE.RUNNING);
                        this.continueProcessing(refundPosition + 1); // Skip this problematic refund
                        
                        // Clear recovery state
                        chrome.storage.local.remove(['recoveryTarget']);
                    }
                });
            }, 15000); // Allow 15 seconds for page to load
            
            return;
        }
        
        // Increment retry counter and set state to retrying
        this.currentRetryCount++;
        this.statsManager.updateStatistics('retry');
        
        // Save state before redirect
        await this.stateManager.saveRecoveryTarget('retry', {
            iteration: this.getRefundPosition(),
            retryCount: this.currentRetryCount
        });
        
        // Notify background script of state change
        chrome.runtime.sendMessage({
            action: "stateChanged",
            state: STATE.RETRYING
        });
        
        // Then redirect to main refund page
        const redirectURL = this.getRedirectURL();
        this.logger.info(`Redirecting to ${redirectURL} for retry #${this.currentRetryCount}`);
        location.replace(redirectURL);
        
        // After reasonable time for page load, try again
        this.timeoutID = setTimeout(() => {
            chrome.storage.local.get(['extensionState', 'recoveryTarget'], (result) => {
                if (result.extensionState === STATE.RETRYING) {
                    this.logger.info("Resuming from recovery redirect");
                    this.stateManager.setState(STATE.RUNNING);
                    
                    // Notify background script of state change
                    chrome.runtime.sendMessage({
                        action: "stateChanged",
                        state: STATE.RUNNING
                    });
                    
                    // Determine timeout based on retry count
                    const timeoutDuration = this.currentRetryCount === 1 
                        ? config.retryTimeout 
                        : config.extendedTimeout;
                    
                    this.resetTimeout(timeoutDuration);
                    this.continueProcessing();
                    
                    // Clear recovery state
                    chrome.storage.local.remove(['recoveryTarget']);
                }
            });
        }, 7000); // Wait 7 seconds for page to load
    }
    
    /**
     * Reset the stall detection timeout
     */
    resetTimeout(timeoutDuration) {
        // This should be implemented by the RefundProcessor
        this.logger.error('resetTimeout must be implemented by RefundProcessor');
    }
    
    /**
     * Continue processing refunds
     */
    continueProcessing(position) {
        // This should be implemented by the RefundProcessor
        this.logger.error('continueProcessing must be implemented by RefundProcessor');
    }
    
    /**
     * Get the current refund position
     */
    getRefundPosition() {
        // This should be implemented by the RefundProcessor
        this.logger.error('getRefundPosition must be implemented by RefundProcessor');
        return 0;
    }
    
    /**
     * Get the refund details from the page
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
                refundId: refundId || `refund-${this.getRefundPosition()}`,
                amount: refundAmount
            };
        } catch (error) {
            this.logger.error(`Error getting refund details: ${error.message}`);
            return {
                refundId: `refund-${this.getRefundPosition()}`,
                amount: 0
            };
        }
    }
    
    /**
     * Get the redirect URL for recovery
     */
    getRedirectURL() {
        // This should be provided by the Config
        return "https://cargo.nellisauction.com/operations/returns?tab=awaitingProcessing";
    }
    
    /**
     * Get the current config
     */
    async getConfig() {
        // This should be provided by a Config instance
        const data = await new Promise(resolve => {
            chrome.storage.local.get([
                'initialTimeout',
                'retryTimeout',
                'extendedTimeout',
                'maxRetries'
            ], resolve);
        });
        
        return {
            initialTimeout: data.initialTimeout || 30000,
            retryTimeout: data.retryTimeout || 10000,
            extendedTimeout: data.extendedTimeout || 20000,
            maxRetries: data.maxRetries || 3
        };
    }
    
    /**
     * Set the reference to the RefundProcessor after creation
     */
    setRefundProcessor(refundProcessor) {
        this.refundProcessor = refundProcessor;
        
        // Override the placeholder methods with the actual implementations
        this.resetTimeout = (timeoutDuration) => {
            refundProcessor.resetTimeout(timeoutDuration);
        };
        
        this.continueProcessing = (position) => {
            if (position !== undefined) {
                refundProcessor.setCurrentIteration(position);
            }
            refundProcessor.continueProcessing();
        };
        
        this.getRefundPosition = () => {
            return refundProcessor.getCurrentIteration();
        };
        
        this.getRedirectURL = () => {
            return refundProcessor.getRedirectURL();
        };
    }
    
    /**
     * Get the current retry count
     */
    getRetryCount() {
        return this.currentRetryCount;
    }
    
    /**
     * Set the current retry count
     */
    setRetryCount(count) {
        this.currentRetryCount = count;
    }
    
    /**
     * Check if the current refund should be skipped
     */
    shouldSkipCurrentRefund() {
        return this.skipCurrentRefund;
    }
    
    /**
     * Set whether the current refund should be skipped
     */
    setSkipCurrentRefund(skip) {
        this.skipCurrentRefund = skip;
    }
    
    /**
     * Reset error handler state for a new refund
     */
    reset() {
        this.currentRetryCount = 0;
        this.skipCurrentRefund = false;
        this.redirectCount = 0;
        
        if (this.timeoutID) {
            clearTimeout(this.timeoutID);
            this.timeoutID = null;
        }
    }
}