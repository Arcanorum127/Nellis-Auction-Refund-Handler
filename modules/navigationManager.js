/*
Name: Brice Blanchard
Date: 3/17/2025
Project: Nellis Auction Refund Handler
Version: 3.0
*/

/**
 * Manages navigation within the Nellis Auction site
 */
export class NavigationManager {
    constructor(logger) {
        this.logger = logger;
        this.redirectCount = 0;
        this.lastActivityTimestamp = 0;
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
     * Navigate to the awaiting refunds page
     */
    toAwaitingRefunds() {
        this.recordActivity();
        const awaitingRefundsPage = Array.from(document.querySelectorAll('.teal.item.tw-flex.tw-w-full.tw-justify-between'))
            .find(button => button.innerText.includes('Awaiting Refunds'));
        
        if (awaitingRefundsPage) {
            this.logger.debug('Clicking Awaiting Refunds page button');
            awaitingRefundsPage.click();
            return true;
        } else {
            this.logger.warn('Awaiting Refunds page button not found. This could be normal during page load.');
            return false;
        }
    }
    
    /**
     * Begin processing awaiting refunds by selecting the appropriate button
     */
    beginAwaitingRefunds(iteration, redirectCount, skipCurrentRefund) {
        this.recordActivity();
        
        // Get all refund buttons
        const buttons = document.querySelectorAll(".ui.fluid.button.ui.basic.label");
        
        // If we need to skip the current refund, adjust the index
        let buttonIndex = iteration % 7 + (redirectCount || 0);
        
        if (skipCurrentRefund) {
            this.logger.info(`Skipping problematic refund, adjusting button index from ${buttonIndex} to ${buttonIndex + 1}`);
            buttonIndex++;
        }
        
        if (buttons.length > 0) {
            // Ensure the index is within bounds
            buttonIndex = Math.min(buttonIndex, buttons.length - 1);
            this.logger.debug(`Selecting refund button at index ${buttonIndex} of ${buttons.length}`);
            
            try {
                buttons[buttonIndex].click();
                return true;
            } catch (error) {
                this.logger.error(`Error clicking button: ${error.message}`);
                return false;
            }
        } else {
            this.logger.error('No refund buttons found. This could be a page loading issue.');
            return false;
        }
    }
    
    /**
     * Check suggested refund method and initiate the refund
     */
    initiateSuggestedRefund() {
        this.recordActivity();
        
        // Check for any error messages currently on the page
        const errorElements = document.querySelectorAll(".ui.red.tiny.compact.message");
        if (errorElements.length > 0) {
            this.logger.warn("Error message detected on page:", errorElements[0].textContent);
            return false;
        }
        
        // The teal label div is what contains whether the suggested return is store credit or original payment
        const suggestedRefund = document.querySelector(".ui.teal.tiny.label.tw-ml-2");
        
        if (suggestedRefund) {
            // Check for the specific icon class inside the div to determine proper refund method
            const icon = suggestedRefund.querySelector("i");
            
            if (icon) {
                // If suggested refund is listed as store credit
                if (icon.classList.contains("bitcoin")) {
                    // Run the store credit refund function
                    this.logger.debug("Identified store credit refund");
                    return this.storeCreditRefund();
                    // If suggested refund is listed as original payment
                } else if (icon.classList.contains("credit")) {
                    // Run the original payment refund function
                    this.logger.debug("Identified original payment refund");
                    return this.originalPaymentRefund();
                }
            }
        }
        
        this.logger.error("Could not determine suggested refund type");
        return false;
    }
    
    /**
     * Process a store credit refund
     */
    storeCreditRefund() {
        this.recordActivity();
        
        // Kept it simple as the first button is always store credit
        const storeCredButton = document.querySelector(".ui.blue.tiny.basic.button.tw-mr-0");
        
        if (storeCredButton) {
            this.logger.debug("Clicking store credit button");
            storeCredButton.click();
            return true;
        }
        
        this.logger.error("Store credit button not found");
        return false;
    }
    
    /**
     * Process an original payment refund
     */
    originalPaymentRefund() {
        this.recordActivity();
        
        // Kept simple as well since even if there are multiple original payments the top one is always used
        const buttons = document.querySelectorAll(".ui.blue.tiny.basic.button.tw-mr-0");
        
        if (buttons.length >= 2) {
            // Clicks the second fill button
            this.logger.debug("Clicking original payment button");
            buttons[1].click();
            return true;
        } else {
            // Fall back to store credit if original payment button not found
            this.logger.warn("Original payment button not found, falling back to store credit");
            return this.storeCreditRefund();
        }
    }
    
    /**
     * Complete the refund
     */
    completeRefund() {
        this.recordActivity();
        
        const refundButton = document.querySelector(".ui.green.tiny.button");
        
        if (refundButton) {
            this.logger.debug("Clicking complete refund button");
            refundButton.click();
            return true;
        }
        
        this.logger.error("Complete refund button not found");
        return false;
    }
    
    /**
     * Finalize the refund
     */
    finalizeRefund() {
        this.recordActivity();
        
        const finalizeButton = document.querySelector("button.ui.green.mini.button:has(i.checkmark.icon)");
        
        if (finalizeButton) {
            this.logger.debug("Clicking finalize button");
            finalizeButton.click();
            return true;
        }
        
        this.logger.error("Finalize button not found");
        return false;
    }
    
    /**
     * Wait for an element to appear in the DOM
     */
    waitForElement(selector, timeout = 5000) {
        this.recordActivity();
        
        return new Promise((resolve, reject) => {
            // First check if element already exists
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }
            
            // Set a timeout to reject the promise
            const timeoutId = setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout waiting for ${selector}`));
            }, timeout);
            
            // If not, set up an observer
            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    clearTimeout(timeoutId);
                    observer.disconnect();
                    resolve(element);
                }
            });
            
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }
    
    /**
     * Redirect to the main refund processing page
     */
    async timeoutRedirect(redirectURL) {
        this.redirectCount++;
        
        // Save state before redirecting
        await new Promise(resolve => {
            chrome.storage.local.set({
                redirectState: {
                    redirectCount: this.redirectCount,
                    timestamp: Date.now()
                }
            }, resolve);
        });
        
        this.logger.info(`Redirect ${this.redirectCount} initiated to ${redirectURL}`);
        location.replace(redirectURL);
    }
    
    /**
     * Wait for a specified amount of time
     */
    waitFor(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * Get the current redirect count
     */
    getRedirectCount() {
        return this.redirectCount;
    }
    
    /**
     * Set the redirect count
     */
    setRedirectCount(count) {
        this.redirectCount = count;
    }
    
    /**
     * Reset the navigation manager
     */
    reset() {
        this.redirectCount = 0;
        this.lastActivityTimestamp = Date.now();
    }
}