/*
Name: Brice Blanchard
Date: 3/17/2025
Project: Nellis Auction Refund Handler
Version: 2.1
*/

// Global State Management
const STATE = {
    NOT_RUNNING: 'notRunning',
    RUNNING: 'running',
    PAUSED: 'paused',
    RETRYING: 'retrying'
}

// Improved recovery mechanism for when processing stalls
function recoverFromStall() {
    if (extensionState !== STATE.RUNNING || processingPaused) {
        return;
    }

    console.log(`Recovery attempt #${currentRetryCount + 1} initiated`);
    clearTimeout(timeoutID);

    // If we've retried too many times on this refund
    if (currentRetryCount >= config.maxRetries) {
        console.log(`Maximum retries (${config.maxRetries}) reached for current refund, skipping...`);
        skipCurrentRefund = true;
        currentRetryCount = 0;
        updateStatistics('skip', {
            refundId: `refund-${currentIteration}`,
            retries: config.maxRetries
        });

        // Save state before redirect
        chrome.storage.local.set({
            extensionState: STATE.RETRYING,
            recoveryTarget: {
                action: 'skip',
                iteration: currentIteration + 1
            }
        }, function () {
            // Then redirect to main page
            location.replace(redirectURL);
        });

        // Set a timer to check if we've loaded the new page
        timeoutID = setTimeout(() => {
            chrome.storage.local.get(['extensionState', 'recoveryTarget'], function (result) {
                if (result.extensionState === STATE.RETRYING) {
                    console.log("Recovery redirect did not complete, attempting to force resume");
                    extensionState = STATE.RUNNING;
                    currentIteration++; // Skip this problematic refund
                    resetTimeout();
                    continueRefundProcess();

                    // Clear recovery state
                    chrome.storage.local.remove(['recoveryTarget']);
                }
            });
        }, 15000); // Allow 15 seconds for page to load

        return;
    }

    // Increment retry counter and set state to retrying
    currentRetryCount++;
    updateStatistics('retry');

    // Save state before redirect
    chrome.storage.local.set({
        extensionState: STATE.RETRYING,
        recoveryTarget: {
            action: 'retry',
            iteration: currentIteration,
            retryCount: currentRetryCount
        }
    }, function () {
        // Notify background script of state change
        chrome.runtime.sendMessage({
            action: "stateChanged",
            state: STATE.RETRYING
        });

        // Then redirect to main refund page
        location.replace(redirectURL);
    });

    // After reasonable time for page load, try again
    timeoutID = setTimeout(() => {
        chrome.storage.local.get(['extensionState', 'recoveryTarget'], function (result) {
            if (result.extensionState === STATE.RETRYING) {
                console.log("Resuming from recovery redirect");
                extensionState = STATE.RUNNING;

                // Notify background script of state change
                chrome.runtime.sendMessage({
                    action: "stateChanged",
                    state: STATE.RUNNING
                });

                resetTimeout(currentRetryCount === 1 ? config.retryTimeout : config.extendedTimeout);
                continueRefundProcess();

                // Clear recovery state
                chrome.storage.local.remove(['recoveryTarget']);
            }
        });
    }, 7000); // Wait 7 seconds for page to load
}

// Enhanced timeout reset function with configurable duration
function resetTimeout(timeoutDuration = config.initialTimeout) {
    if (extensionState === STATE.RUNNING) {
        clearTimeout(timeoutID);
        timeoutID = setTimeout(() => {
            recoverFromStall();
        }, timeoutDuration);

        // Save the timeout info in case of page reload
        chrome.storage.local.set({
            timeoutInfo: {
                timeoutSet: Date.now(),
                timeoutDuration: timeoutDuration
            }
        });
    }
}

// Listen for messages from popup and background
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    switch (request.action) {
        case "startRefundProcess":
            // Update settings from popup
            refundLimit = request.refundLimit || 500;
            refundsToProcess = request.refundsToProcess || 200;

            // Update configuration if provided
            if (request.config) {
                config = { ...DEFAULT_CONFIG, ...request.config };
            }

            // Reset statistics for new run
            statistics = {
                startTime: Date.now(),
                endTime: null,
                totalProcessed: 0,
                successful: 0,
                skipped: 0,
                failed: 0,
                retryAttempts: 0,
                averageProcessingTime: 0,
                totalProcessingTime: 0,
                refundDetails: []
            };

            // Reset state variables
            extensionState = STATE.RUNNING;
            currentIteration = 0;
            processingPaused = false;
            currentRetryCount = 0;
            skipCurrentRefund = false;

            // Notify background script of state change
            chrome.runtime.sendMessage({
                action: "stateChanged",
                state: STATE.RUNNING
            });

            // Start error monitoring
            startErrorMonitoring();

            // Start heartbeat monitoring
            startHeartbeat();

            // Start the refund process
            runRefundProcess(refundsToProcess);

            // Send success response
            sendResponse({ success: true });
            break;

        case "pauseRefundProcess":
            processingPaused = true;
            extensionState = STATE.PAUSED;

            // Notify background script of state change
            chrome.runtime.sendMessage({
                action: "stateChanged",
                state: STATE.PAUSED
            });

            clearTimeout(timeoutID); // Clear any pending timeout
            sendResponse({
                success: true,
                progress: {
                    current: currentIteration,
                    total: refundsToProcess
                },
                statistics: getStatisticsSummary()
            });
            break;

        case "resumeRefundProcess":
            processingPaused = false;
            extensionState = STATE.RUNNING;

            // Notify background script of state change
            chrome.runtime.sendMessage({
                action: "stateChanged",
                state: STATE.RUNNING
            });

            resetTimeout();

            // If process was paused mid-sequence, continue from where it left off
            if (currentIteration < refundsToProcess) {
                continueRefundProcess();
            }

            sendResponse({
                success: true,
                progress: {
                    current: currentIteration,
                    total: refundsToProcess
                },
                statistics: getStatisticsSummary()
            });
            break;

        case "stopRefundProcess":
            stopProcessing();
            // Update final statistics
            updateStatistics('end');
            sendResponse({
                success: true,
                statistics: getStatisticsSummary()
            });
            break;

        case "getState":
            sendResponse({
                state: extensionState,
                progress: {
                    current: currentIteration,
                    total: refundsToProcess
                },
                statistics: getStatisticsSummary()
            });
            break;

        case "getStatistics":
            sendResponse({
                statistics: getStatisticsSummary()
            });
            break;

        case "checkRecoveryState":
            // This is a message from the background script after page reload
            console.log("Received recovery state check request");

            // Check if we need to recover from a redirect/retry state
            chrome.storage.local.get(['extensionState', 'recoveryTarget'], function (result) {
                if (result.extensionState === STATE.RETRYING && result.recoveryTarget) {
                    console.log("Found recovery target, starting recovery process");

                    // Start recovery with a short delay to ensure page is ready
                    setTimeout(() => {
                        // Set the local extension state from storage
                        extensionState = STATE.RUNNING;

                        // Apply recovery target settings
                        if (result.recoveryTarget.action === 'skip') {
                            currentIteration = result.recoveryTarget.iteration;
                            skipCurrentRefund = false;
                            currentRetryCount = 0;
                        } else if (result.recoveryTarget.action === 'retry') {
                            currentIteration = result.recoveryTarget.iteration;
                            currentRetryCount = result.recoveryTarget.retryCount;
                        }

                        // Clear recovery target
                        chrome.storage.local.remove(['recoveryTarget']);

                        // Notify background script of state change
                        chrome.runtime.sendMessage({
                            action: "stateChanged",
                            state: STATE.RUNNING
                        });

                        // Start processing again with appropriate timeout
                        resetTimeout();
                        startHeartbeat();
                        startErrorMonitoring();
                        continueRefundProcess();
                    }, 1000);
                }
            });

            // Send immediate response to prevent errors
            sendResponse({ acknowledged: true });
            break;
    }
    return true; // Keep the message channel open for async response
});

// Set extension state with notifications to background script
function setExtensionState(newState) {
    // Only notify if the state is changing
    if (extensionState !== newState) {
        extensionState = newState;

        // Notify background script of state change
        chrome.runtime.sendMessage({
            action: "stateChanged",
            state: newState
        });

        // Update in storage
        chrome.storage.local.set({ extensionState: newState });
    }
}

function getStatisticsSummary() {
    // Create a summary of statistics for sending to the popup
    return {
        totalProcessed: statistics.totalProcessed,
        successful: statistics.successful,
        skipped: statistics.skipped,
        failed: statistics.failed,
        retryAttempts: statistics.retryAttempts,
        averageProcessingTime: statistics.averageProcessingTime,
        startTime: statistics.startTime,
        endTime: statistics.endTime || Date.now(), // Use current time if not ended
        runningTime: statistics.startTime ? ((statistics.endTime || Date.now()) - statistics.startTime) : 0
    };
}

function stopProcessing() {
    // Clear any pending timeouts
    clearTimeout(timeoutID);

    // Stop error monitoring
    stopErrorMonitoring();

    // Reset all state variables
    extensionState = STATE.NOT_RUNNING;

    // Notify background script of state change
    chrome.runtime.sendMessage({
        action: "stateChanged",
        state: STATE.NOT_RUNNING
    });

    processingPaused = false;
    redirectCount = 0;

    // Update final statistics
    updateStatistics('end');

    // Save state to storage
    chrome.storage.local.set({
        extensionState: STATE.NOT_RUNNING,
        currentProgress: null,
        statistics: statistics
    });

    console.log("Processing stopped completely");
}

function continueRefundProcess() {
    console.log(`Resuming from iteration: ${currentIteration + 1}`);
    recordActivity(); // Record this as activity for heartbeat

    // Get correct refund count from storage before continuing
    chrome.storage.local.get(['refundsToProcess', 'currentProgress'], function (data) {
        if (data.refundsToProcess) {
            // Make sure we have the correct total
            refundsToProcess = data.refundsToProcess;

            // Double check current iteration from stored progress
            if (data.currentProgress && data.currentProgress.current !== undefined) {
                currentIteration = data.currentProgress.current;
            }

            // CRITICAL: Check if we've already reached the limit
            if (currentIteration >= refundsToProcess) {
                console.log(`Cannot continue: already reached limit of ${refundsToProcess} refunds.`);

                // Update state to not running
                extensionState = STATE.NOT_RUNNING;

                // Notify background script of state change
                chrome.runtime.sendMessage({
                    action: "stateChanged",
                    state: STATE.NOT_RUNNING
                });

                // Update final statistics
                updateStatistics('end');

                // Send completion notification
                chrome.runtime.sendMessage({
                    action: "processingComplete",
                    statistics: getStatisticsSummary()
                });

                chrome.storage.local.set({ extensionState: STATE.NOT_RUNNING });
                return;
            }

            // Calculate remaining refunds
            const remainingRefunds = refundsToProcess - currentIteration;

            console.log(`Continuing with ${remainingRefunds} refunds remaining to process (total: ${refundsToProcess})`);

            // Run the refund process with the correct remaining count
            runRefundProcess(remainingRefunds);
        } else {
            // If we don't have stored refundsToProcess, use what we have locally
            console.log(`No stored refundsToProcess found, using local value: ${refundsToProcess}`);
            const remainingRefunds = refundsToProcess - currentIteration;
            runRefundProcess(remainingRefunds);
        }
    });
}

// Will reload and redirect to awaiting refunds page with improved state management
async function timeoutRedirect() {
    redirectCount++;

    // Save state before redirecting
    await new Promise(resolve => {
        chrome.storage.local.set({
            redirectState: {
                extensionState: extensionState,
                currentIteration: currentIteration,
                redirectCount: redirectCount,
                timestamp: Date.now()
            }
        }, resolve);
    });

    console.log("Redirect " + redirectCount + " Initiated. Saving state before redirect.");
    location.replace(redirectURL);
}

// Attempts to bring the extension to the awaiting refunds page
function toAwaitingRefunds() {
    recordActivity(); // Record this as activity for heartbeat
    const awaitingRefundsPage = Array.from(document.querySelectorAll('.teal.item.tw-flex.tw-w-full.tw-justify-between'))
        .find(button => button.innerText.includes('Awaiting Refunds'));

    if (awaitingRefundsPage) {
        awaitingRefundsPage.click();
        return true;
    } else {
        console.log('Awaiting Refunds page button not found. This could be normal during page load.');
        return false;
    }
}

// Function attempts to initiate the refund process as long as there is a valid entry
function beginAwaitingRefunds(x) {
    recordActivity(); // Record this as activity for heartbeat

    // Get all refund buttons
    const buttons = document.querySelectorAll(".ui.fluid.button.ui.basic.label");

    // If we need to skip the current refund, adjust the index
    let buttonIndex = x % 7 + redirectCount;

    if (skipCurrentRefund) {
        console.log(`Skipping problematic refund, adjusting button index from ${buttonIndex} to ${buttonIndex + 1}`);
        buttonIndex++;
        skipCurrentRefund = false; // Reset skip flag
    }

    if (buttons.length > 0) {
        // Ensure the index is within bounds
        buttonIndex = Math.min(buttonIndex, buttons.length - 1);
        console.log(`Selecting refund button at index ${buttonIndex} of ${buttons.length}`);

        try {
            buttons[buttonIndex].click();
            return true;
        } catch (error) {
            console.error(`Error clicking button: ${error.message}`);
            return false;
        }
    } else {
        console.error('No refund buttons found. This could be a page loading issue.');
        return false;
    }
}

// Function checks suggested refund method and initiates the refund
function initiateSuggestedRefund() {
    recordActivity(); // Record this as activity for heartbeat

    // Check for any error messages currently on the page
    const errorElements = document.querySelectorAll(".ui.red.tiny.compact.message");
    if (errorElements.length > 0) {
        console.log("Error message detected on page:", errorElements[0].textContent);
        handleErrorDetected(errorElements[0].textContent);
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
                return storeCreditRefund();
                // If suggested refund is listed as original payment
            } else if (icon.classList.contains("credit")) {
                // Run the original payment refund function
                return originalPaymentRefund();
            }
        }
    }

    console.error("Could not determine suggested refund type");
    return false;
}

function storeCreditRefund() {
    recordActivity(); // Record this as activity for heartbeat

    // Kept it simple as the first button is always store credit
    const storeCredButton = document.querySelector(".ui.blue.tiny.basic.button.tw-mr-0");

    if (storeCredButton) {
        storeCredButton.click();
        return true;
    }

    console.error("Store credit button not found");
    return false;
}

function originalPaymentRefund() {
    recordActivity(); // Record this as activity for heartbeat

    // Kept simple as well since even if there are multiple original payments the top one is always used
    const buttons = document.querySelectorAll(".ui.blue.tiny.basic.button.tw-mr-0");

    if (buttons.length >= 2) {
        // Clicks the second fill button
        buttons[1].click();
        return true;
    } else {
        // Fall back to store credit if original payment button not found
        console.log("Original payment button not found, falling back to store credit");
        return storeCreditRefund();
    }
}

function completeRefund() {
    recordActivity(); // Record this as activity for heartbeat

    const refundButton = document.querySelector(".ui.green.tiny.button");

    if (refundButton) {
        refundButton.click();
        return true;
    }

    console.error("Complete refund button not found");
    return false;
}

function finalizeRefund() {
    recordActivity(); // Record this as activity for heartbeat

    const finalizeButton = document.querySelector("button.ui.green.mini.button:has(i.checkmark.icon)");

    if (finalizeButton) {
        finalizeButton.click();
        return true;
    }

    console.error("Finalize button not found");
    return false;
}

function waitForElement(selector, timeout = 5000) {
    recordActivity(); // Record this as activity for heartbeat

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

// Get refund details (ID, amount) for tracking
function getRefundDetails() {
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
            refundId: refundId || `refund-${currentIteration}`,
            amount: refundAmount
        };
    } catch (error) {
        console.error(`Error getting refund details: ${error.message}`);
        return {
            refundId: `refund-${currentIteration}`,
            amount: 0
        };
    }
}

async function executeRefundSequence(n) {
    const sequenceStartTime = Date.now();
    let refundDetails = { refundId: `refund-${currentIteration}`, amount: 0 };

    try {
        // Check if processing has been paused or stopped
        if (processingPaused || extensionState !== STATE.RUNNING) {
            console.log("Processing paused or stopped during sequence execution");
            return false;
        }

        // First run doesn't need to wait for elements since we're already on the page
        if (n !== 0) {
            try {
                await waitForElement('.teal.item.tw-flex.tw-w-full.tw-justify-between', 10000);
            } catch (error) {
                console.error("Timeout waiting for refund page navigation elements");
                return false;
            }
        }

        console.log(`Processing refund: ${currentIteration + 1}`);
        if (!toAwaitingRefunds()) {
            return false;
        }

        // Wait for refund buttons to appear
        try {
            await waitForElement('.ui.fluid.button.ui.basic.label', 10000);
        } catch (error) {
            console.error("Timeout waiting for refund buttons");
            return false;
        }

        if (!beginAwaitingRefunds(n)) {
            return false;
        }

        try {
            await waitForElement('.ui.teal.tiny.label.tw-ml-2', 10000);
        } catch (error) {
            console.error("Timeout waiting for refund details");
            return false;
        }

        await waitFor(1500);

        // Check again if processing has been paused or stopped
        if (processingPaused || extensionState !== STATE.RUNNING) {
            return false;
        }

        // Check for any error messages on the page
        const errorElements = document.querySelectorAll(".ui.red.tiny.compact.message");
        if (errorElements.length > 0) {
            console.log("Error message detected on page:", errorElements[0].textContent);
            handleErrorDetected(errorElements[0].textContent);
            return false;
        }

        // Get refund details for tracking
        refundDetails = getRefundDetails();

        // This code runs through the refunds and will repeat if there are multiple refunds for one customer
        const refundSteps = document.querySelector('.ui.small.fluid.vertical.steps');
        if (!refundSteps) {
            console.error("Could not find refund steps");
            return false;
        }

        const refundsNum = refundSteps.querySelectorAll('a').length;

        for (let ii = 0; ii < refundsNum; ii++) {
            // Check if processing has been paused or stopped
            if (processingPaused || extensionState !== STATE.RUNNING) {
                return false;
            }
            // This code is for determining if the refund is over the limit, if it is, the refund is skipped
            const refundAmount = document.querySelector('.sub.header')?.textContent.trim();
            if (refundAmount) {
                // Improved regex to properly extract dollar amount, looking for numbers with optional decimal point
                const match = refundAmount.match(/\$?(\d+(?:\.\d+)?)/);
                if (match) {
                    const number = parseFloat(match[1]);
                    console.log(`Detected refund amount: ${number}, limit: ${refundLimit}`);
                    
                    // Checking if the amount is over the refund limit
                    if (number >= refundLimit) {
                        console.log(`Refund amount (${number}) exceeds limit (${refundLimit})! Skipping Refund!`);
                        
                        // Clear any pending timeout
                        clearTimeout(timeoutID);
                        
                        // Update statistics with proper error message
                        updateStatistics('skip', {
                            ...refundDetails,
                            amount: number,
                            errorMessage: `Refund amount (${number}) exceeds limit (${refundLimit})`,
                            processingTime: Date.now() - sequenceStartTime
                        });
                        
                        // Important: Set this flag to true to ensure the refund is skipped
                        skipCurrentRefund = true;
                        
                        // Reset retry counter since we're deliberately skipping
                        currentRetryCount = 0;
                        
                        // Move to next refund by incrementing currentIteration
                        const nextIteration = currentIteration + 1;
                        
                        // Send a message to notify the popup of the skip
                        chrome.runtime.sendMessage({
                            action: "progressUpdate",
                            progress: {
                                current: nextIteration,
                                total: refundsToProcess
                            },
                            statistics: getStatisticsSummary()
                        });
                        
                        // Save state before redirect
                        chrome.storage.local.set({
                            extensionState: STATE.RETRYING,
                            recoveryTarget: {
                                action: 'skip',
                                iteration: nextIteration,
                                errorMessage: `Refund amount (${number}) exceeds limit (${refundLimit})`
                            }
                        }, function() {
                            console.log(`Skip state saved, redirecting to ${redirectURL}`);
                            // Redirect to main page to continue with next refund
                            window.location.replace(redirectURL);
                        });
                        
                        // Set a backup timeout to force continue if redirect fails
                        timeoutID = setTimeout(() => {
                            console.log("Redirect timeout, forcing process to continue");
                            chrome.storage.local.get(['extensionState'], function(result) {
                                if (result.extensionState === STATE.RETRYING) {
                                    extensionState = STATE.RUNNING;
                                    currentIteration = nextIteration; // Skip to next refund
                                    resetTimeout();
                                    continueRefundProcess();
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
                console.log("Error message detected before refund initiation:", errorText);
                handleErrorDetected(errorText);
                return false;
            }

            if (!initiateSuggestedRefund()) {
                return false;
            }

            // If the suggested method is original payment, yet there is only a store credit button, then fill store credit and proceed
            const refundAmountLeft = document.querySelector('.sub.header');

            try {
                await waitForElement('.ui.green.tiny.button', 10000);
            } catch (error) {
                console.error("Timeout waiting for complete refund button");
                return false;
            }

            // Check for any error messages before completing the refund
            if (document.querySelector(".ui.red.tiny.compact.message")) {
                const errorText = document.querySelector(".ui.red.tiny.compact.message").textContent;
                console.log("Error message detected before completing refund:", errorText);
                handleErrorDetected(errorText);
                return false;
            }

            if (!completeRefund()) {
                return false;
            }

            try {
                await waitForElement('button.ui.green.mini.button:has(i.checkmark.icon)', 10000);
            } catch (error) {
                console.error("Timeout waiting for finalize button");
                return false;
            }

            // Check for any error messages before finalizing
            if (document.querySelector(".ui.red.tiny.compact.message")) {
                const errorText = document.querySelector(".ui.red.tiny.compact.message").textContent;
                console.log("Error message detected before finalizing:", errorText);
                handleErrorDetected(errorText);
                return false;
            }

            if (!finalizeRefund()) {
                return false;
            }

            // Waiting long enough to determine if the payment amount has been met
            await waitFor(1300);

            // Check for any error messages after first refund attempt
            if (document.querySelector(".ui.red.tiny.compact.message")) {
                const errorText = document.querySelector(".ui.red.tiny.compact.message").textContent;
                console.log("Error message detected after first refund attempt:", errorText);
                handleErrorDetected(errorText);
                return false;
            }

            // If original payment method isn't enough, add store credit
            if (refundAmountLeft &&
                refundAmountLeft.textContent.trim() !== "$0.00 remaining" &&
                refundAmountLeft.textContent.includes('remaining')) {

                if (!storeCreditRefund()) {
                    return false;
                }

                try {
                    await waitForElement('.ui.green.tiny.button', 10000);
                } catch (error) {
                    console.error("Timeout waiting for complete refund button (remainder)");
                    return false;
                }

                // Check for any error messages before completing the remainder
                if (document.querySelector(".ui.red.tiny.compact.message")) {
                    const errorText = document.querySelector(".ui.red.tiny.compact.message").textContent;
                    console.log("Error message detected before completing remainder:", errorText);
                    handleErrorDetected(errorText);
                    return false;
                }

                if (!completeRefund()) {
                    return false;
                }

                try {
                    await waitForElement('button.ui.green.mini.button:has(i.checkmark.icon)', 10000);
                } catch (error) {
                    console.error("Timeout waiting for finalize button (remainder)");
                    return false;
                }

                // Check for any error messages before finalizing remainder
                if (document.querySelector(".ui.red.tiny.compact.message")) {
                    const errorText = document.querySelector(".ui.red.tiny.compact.message").textContent;
                    console.log("Error message detected before finalizing remainder:", errorText);
                    handleErrorDetected(errorText);
                    return false;
                }

                if (!finalizeRefund()) {
                    return false;
                }

                // Check for any final error messages
                if (document.querySelector(".ui.red.tiny.compact.message")) {
                    const errorText = document.querySelector(".ui.red.tiny.compact.message").textContent;
                    console.log("Error message detected after completing refund process:", errorText);
                    handleErrorDetected(errorText);
                    return false;
                }
            }
        }

        // Calculate processing time for this refund
        const processingTime = Date.now() - sequenceStartTime;

        // Update statistics for successful refund
        updateStatistics('success', {
            ...refundDetails,
            processingTime,
            retries: currentRetryCount
        });

        // Reset retry counter since we succeeded
        currentRetryCount = 0;

        // Update progress in storage
        chrome.storage.local.set({
            currentProgress: {
                current: currentIteration + 1,
                total: refundsToProcess
            }
        });

        return true;
    } catch (error) {
        console.error(`Error in executeRefundSequence: ${error.message}`);

        // Update statistics for failed refund
        updateStatistics('fail', {
            ...refundDetails,
            processingTime: Date.now() - sequenceStartTime,
            retries: currentRetryCount
        });

        return false;
    }
}

// Function to wait for a specified amount of time
function waitFor(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to run the refund process for a specified number of iterations
async function runRefundProcess(iterations) {
    // Make sure we have the correct total
    refundsToProcess = iterations;

    // Double-check and enforce limit from storage
    chrome.storage.local.get(['refundsToProcess'], function (data) {
        if (data.refundsToProcess) {
            // Store the correct value and use it for display and checking
            refundsToProcess = data.refundsToProcess;

            // Update progress in storage with corrected total
            chrome.storage.local.set({
                currentProgress: {
                    current: currentIteration,
                    total: refundsToProcess
                }
            });
        }
    });

    for (let i = 0; i < iterations; i++) {
        // CRITICAL: Double-check we haven't exceeded the total refunds to process
        if (currentIteration >= refundsToProcess) {
            console.log(`Reached maximum number of refunds to process (${refundsToProcess}). Stopping.`);

            // Update state to no longer running
            extensionState = STATE.NOT_RUNNING;

            // Notify background script of state change
            chrome.runtime.sendMessage({
                action: "stateChanged",
                state: STATE.NOT_RUNNING
            });

            // Update final statistics
            updateStatistics('end');

            // Send completion notification
            chrome.runtime.sendMessage({
                action: "processingComplete",
                statistics: getStatisticsSummary()
            });

            chrome.storage.local.set({ extensionState: STATE.NOT_RUNNING });
            break;
        }

        // Check if processing has been paused or stopped
        if (processingPaused || extensionState !== STATE.RUNNING) {
            console.log("Processing paused or stopped");
            break;
        }

        resetTimeout();
        console.log(`Starting iteration: ${currentIteration + 1}`);

        // Execute refund sequence and handle result
        const success = await executeRefundSequence(currentIteration);

        // Only increment if the process wasn't paused or stopped
        if (!processingPaused && extensionState === STATE.RUNNING) {
            currentIteration++;

            // IMPORTANT: Update progress in storage BEFORE continuing
            await new Promise(resolve => {
                chrome.storage.local.set({
                    currentProgress: {
                        current: currentIteration,
                        total: refundsToProcess
                    }
                }, resolve);
            });

            // Send progress update
            chrome.runtime.sendMessage({
                action: "progressUpdate",
                progress: {
                    current: currentIteration,
                    total: refundsToProcess
                },
                statistics: getStatisticsSummary()
            });

            console.log(`Completed iteration: ${currentIteration}`);

            // Add delay between iterations to avoid overloading
            await waitFor(350);

            // ADDED SAFETY CHECK: Break if we've reached the limit
            if (currentIteration >= refundsToProcess) {
                console.log(`Reached limit of ${refundsToProcess} refunds. Stopping.`);
                break;
            }

            // If the sequence failed but we haven't hit retry limit
            if (!success && currentRetryCount < config.maxRetries) {
                console.log(`Refund sequence failed, attempting retry #${currentRetryCount + 1}`);
                i--; // Retry this iteration
                recoverFromStall();
                break; // Break the loop, retry will restart it
            }
        }
    }

    // If we've completed all iterations and weren't paused/stopped
    if (currentIteration >= refundsToProcess && !processingPaused && extensionState === STATE.RUNNING) {
        console.log('All iterations completed!');
        extensionState = STATE.NOT_RUNNING;

        // Notify background script of state change
        chrome.runtime.sendMessage({
            action: "stateChanged",
            state: STATE.NOT_RUNNING
        });

        // Update final statistics
        updateStatistics('end');

        // Send completion notification
        chrome.runtime.sendMessage({
            action: "processingComplete",
            statistics: getStatisticsSummary()
        });

        chrome.storage.local.set({ extensionState: STATE.NOT_RUNNING });

        // Show desktop notification if possible
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Refund Processing Complete', {
                body: `Successfully processed ${statistics.successful} refunds`
            });
        }
    }
}

// Add this function to properly restore timeout after a page reload
function restoreTimeoutIfNeeded() {
    chrome.storage.local.get(['timeoutInfo'], function (result) {
        if (result.timeoutInfo && extensionState === STATE.RUNNING) {
            const now = Date.now();
            const elapsedTime = now - result.timeoutInfo.timeoutSet;

            // If original timeout hasn't expired yet, set a new one for remaining time
            if (elapsedTime < result.timeoutInfo.timeoutDuration) {
                const remainingTime = result.timeoutInfo.timeoutDuration - elapsedTime;
                console.log(`Restoring timeout with ${remainingTime}ms remaining`);
                clearTimeout(timeoutID);
                timeoutID = setTimeout(() => {
                    recoverFromStall();
                }, remainingTime);
            }
            // If original timeout would have expired, trigger recovery immediately
            else if (elapsedTime >= result.timeoutInfo.timeoutDuration) {
                console.log("Timeout would have expired during page reload, triggering recovery");
                setTimeout(() => {
                    recoverFromStall();
                }, 1000); // Small delay to let page initialize
            }
        }
    });
}

// Add this function to handle redirect state restoration
function restoreRedirectStateIfNeeded() {
    chrome.storage.local.get(['redirectState'], function (result) {
        if (result.redirectState) {
            const now = Date.now();
            const redirectTime = result.redirectState.timestamp;
            const timeSinceRedirect = now - redirectTime;

            // Only restore if redirect was recent (within 30 seconds)
            if (timeSinceRedirect < 30000) {
                console.log("Restoring state after redirect");
                extensionState = result.redirectState.extensionState;
                currentIteration = result.redirectState.currentIteration;
                redirectCount = result.redirectState.redirectCount;

                // Clear the saved redirect state
                chrome.storage.local.remove(['redirectState']);

                // If we were running, restart processing
                if (extensionState === STATE.RUNNING) {
                    setTimeout(() => {
                        resetTimeout();
                        continueRefundProcess();
                    }, 2000); // Small delay to let page render
                }
            } else {
                // Clear stale redirect state
                chrome.storage.local.remove(['redirectState']);
            }
        }
    });
}

// Run both restore functions during initialization
function initializeWithRecovery() {
    // Initialize statistics
    initializeStatistics();

    // Check for any pending timeouts or redirects
    restoreTimeoutIfNeeded();
    restoreRedirectStateIfNeeded();

    // Then check for normal session recovery
    chrome.storage.local.get(['extensionState', 'recoveryTarget', 'currentProgress', 'statistics'], function (result) {
        // Recover from previous state if needed
        if (result.extensionState === STATE.RETRYING && result.recoveryTarget) {
            console.log("Recovering from interrupted retry/redirect");
            extensionState = STATE.RUNNING;

            // Set appropriate state based on recovery target
            if (result.recoveryTarget.action === 'skip') {
                currentIteration = result.recoveryTarget.iteration;
                skipCurrentRefund = false;
                currentRetryCount = 0;
            } else if (result.recoveryTarget.action === 'retry') {
                currentIteration = result.recoveryTarget.iteration;
                currentRetryCount = result.recoveryTarget.retryCount;
            }

            // Clear recovery target
            chrome.storage.local.remove(['recoveryTarget']);

            // Set proper processing state
            if (result.currentProgress) {
                refundsToProcess = result.currentProgress.total;
            }

            // Restore statistics
            if (result.statistics) {
                statistics = result.statistics;
            }

            // Notify background script of state change
            chrome.runtime.sendMessage({
                action: "stateChanged",
                state: STATE.RUNNING
            });

            // Start processing again with appropriate timeout
            resetTimeout();
            startHeartbeat();
            startErrorMonitoring();
            continueRefundProcess();
        }
        // Otherwise normal initialization
        else if (result.extensionState === STATE.RUNNING || result.extensionState === STATE.PAUSED) {
            console.log("Resuming previous session");

            extensionState = result.extensionState;
            if (result.currentProgress) {
                currentIteration = result.currentProgress.current;
                refundsToProcess = result.currentProgress.total;
            }

            if (result.statistics) {
                statistics = result.statistics;
            }

            // If we were running, restart the process
            if (extensionState === STATE.RUNNING) {
                console.log("Automatically resuming previous run");

                // Notify background script of state
                chrome.runtime.sendMessage({
                    action: "stateChanged",
                    state: STATE.RUNNING
                });

                resetTimeout();
                startHeartbeat();
                startErrorMonitoring();
                continueRefundProcess();
            } else if (extensionState === STATE.PAUSED) {
                // Notify background script of state
                chrome.runtime.sendMessage({
                    action: "stateChanged",
                    state: STATE.PAUSED
                });
            }
        }
    });
}

// Send our initial state when content script loads
chrome.runtime.sendMessage({
    action: "contentScriptLoaded",
    state: extensionState,
    progress: {
        current: currentIteration,
        total: refundsToProcess
    }
});

// Replace the original initialization with our improved version
initializeWithRecovery();;

// Initialization
let timeoutID;
let redirectCount = 0;
let loadingFlag = false;
const redirectURL = "https://cargo.nellisauction.com/operations/returns?tab=awaitingProcessing";
let refundsToProcess = 200;
let refundLimit = 500;

// Configuration defaults - can be overridden from popup
const DEFAULT_CONFIG = {
    initialTimeout: 30000,
    retryTimeout: 10000,
    extendedTimeout: 20000,
    maxRetries: 3,
    heartbeatInterval: 5000
};

// Current configuration
let config = { ...DEFAULT_CONFIG };

// State management variables
let extensionState = STATE.NOT_RUNNING;
let currentIteration = 0;
let processingPaused = false;
let currentRetryCount = 0;
let skipCurrentRefund = false;
let lastActivityTimestamp = 0;

// Statistics tracking
let statistics = {
    startTime: null,
    endTime: null,
    totalProcessed: 0,
    successful: 0,
    skipped: 0,
    failed: 0,
    retryAttempts: 0,
    averageProcessingTime: 0,
    totalProcessingTime: 0,
    // Store individual refund data for detailed reporting
    refundDetails: []
};

// Error observer to detect error messages on the page
let errorObserver = null;

// Initialize or load statistics from storage
function initializeStatistics() {
    chrome.storage.local.get(['statistics'], function (result) {
        if (result.statistics) {
            // Merge stored statistics with any new fields
            statistics = { ...statistics, ...result.statistics };
        }
        if (extensionState === STATE.RUNNING && !statistics.startTime) {
            statistics.startTime = Date.now();
        }
    });
}

// Start monitoring for error messages in the UI
function startErrorMonitoring() {
    if (errorObserver) {
        errorObserver.disconnect();
    }

    errorObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                // Look for error message elements added to the DOM
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        checkForErrorMessage(node);
                    }
                }
            }
        }
    });

    // Start observing the document body for error message additions
    errorObserver.observe(document.body, {
        childList: true,
        subtree: true
    });

    console.log("Error monitoring started");
}

// Stop monitoring for error messages
function stopErrorMonitoring() {
    if (errorObserver) {
        errorObserver.disconnect();
        errorObserver = null;
        console.log("Error monitoring stopped");
    }
}

// Check if an element or its children contain an error message
function checkForErrorMessage(element) {
    // Check if this element is an error message
    if (element.classList && element.classList.contains("ui") &&
        element.classList.contains("red") && element.classList.contains("message")) {
        console.log("Error message detected:", element.textContent);
        handleErrorDetected(element.textContent);
        return true;
    }

    // Check for the specific error message class
    const errorElement = element.querySelector(".ui.red.tiny.compact.message");
    if (errorElement) {
        console.log("Error message detected:", errorElement.textContent);
        handleErrorDetected(errorElement.textContent);
        return true;
    }

    return false;
}

// Heartbeat checking mechanism
function startHeartbeat() {
    lastActivityTimestamp = Date.now();

    const heartbeatInterval = setInterval(() => {
        // Only check if we're supposed to be running
        if (extensionState !== STATE.RUNNING) {
            clearInterval(heartbeatInterval);
            return;
        }

        const now = Date.now();
        const timeSinceLastActivity = now - lastActivityTimestamp;

        // If no activity for longer than our initial timeout, trigger a recovery
        if (timeSinceLastActivity > config.initialTimeout) {
            console.log(`Heartbeat detected inactivity for ${timeSinceLastActivity}ms, triggering recovery`);
            recoverFromStall();
        }
    }, config.heartbeatInterval);

    return heartbeatInterval;
}

// Record activity to prevent false heartbeat triggers
function recordActivity() {
    lastActivityTimestamp = Date.now();
}

// Handle detected error message with improved recovery
function handleErrorDetected(errorText) {
    if (extensionState !== STATE.RUNNING || processingPaused) {
        return;
    }

    console.log(`Error detected: "${errorText}". Skipping current refund.`);

    // Clear any pending timeout
    clearTimeout(timeoutID);

    // Skip the current refund
    skipCurrentRefund = true;

    // Get refund details for tracking
    const refundDetails = getRefundDetails();

    // Update statistics
    updateStatistics('skip', {
        ...refundDetails,
        errorMessage: errorText,
        processingTime: Date.now() - lastActivityTimestamp
    });

    // Reset retry counter since we're deliberately skipping
    currentRetryCount = 0;

    // Save state before redirect
    chrome.storage.local.set({
        extensionState: STATE.RETRYING,
        recoveryTarget: {
            action: 'skip',
            iteration: currentIteration + 1,
            errorMessage: errorText
        }
    }, function () {
        // Redirect to main page and continue with next refund
        location.replace(redirectURL);
    });

    // Set a timer to check if we've loaded the new page
    timeoutID = setTimeout(() => {
        chrome.storage.local.get(['extensionState', 'recoveryTarget'], function (result) {
            if (result.extensionState === STATE.RETRYING) {
                console.log("Error recovery redirect did not complete, attempting to force resume");
                extensionState = STATE.RUNNING;
                currentIteration++; // Skip this problematic refund
                resetTimeout();
                continueRefundProcess();

                // Clear recovery state
                chrome.storage.local.remove(['recoveryTarget']);
            }
        });
    }, 10000); // Allow 10 seconds for page to load
}