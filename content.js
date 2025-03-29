/*
Name: Brice Blanchard
Date: 3/28/2025
Project: Nellis Auction Refund Handler
Version: 1.7
*/

// Initialization
let timeoutID;
let redirectCount = 0;
let loadingFlag = false;
const redirectURL = "https://cargo.nellisauction.com/operations/returns?tab=awaitingProcessing";
const refundsToProcess = 200;
const refundsPerBatch = 10; // Number of refunds to iterate through before restarting
const timeTillTimeout = 30000; // 30 Seconds
const maxRetries = 2; // Maximum number of retries before redirecting
const MAX_REFUND_AMOUNT = 500; // Maximum refund amount to process

// State tracking variables
let currentCustomerIndex = 0;
let currentRefundStep = 0;
let totalRefundSteps = 0;
let processingMultiStep = false;
let lastActivityTimestamp = Date.now();
const INACTIVITY_TIMEOUT = 15000; // 15 seconds of inactivity triggers timeout
let activityCheckInterval;
let currentRetryCount = 0;

// Initialize extension
function initializeExtension() {
    console.log("Nellis Auction Refund Handler initializing...");
    setupActivityTracking();
    startInactivityMonitoring();
    loadState();
    runRefundProcess(refundsToProcess);
}

// Function to track user activity and extension actions
function trackActivity(activityType = 'extension') {
    lastActivityTimestamp = Date.now();
    console.log(`Activity detected (${activityType}), resetting inactivity timer`);
}

// Function to start inactivity monitoring
function startInactivityMonitoring() {
    // Clear any existing intervals
    if (activityCheckInterval) {
        clearInterval(activityCheckInterval);
    }
    
    // Set initial activity timestamp
    lastActivityTimestamp = Date.now();
    
    // Start monitoring for inactivity
    activityCheckInterval = setInterval(() => {
        const currentTime = Date.now();
        const inactiveTime = currentTime - lastActivityTimestamp;
        
        // If inactive for too long, trigger the retry mechanism
        if (inactiveTime >= INACTIVITY_TIMEOUT) {
            console.log(`Inactivity detected for ${inactiveTime/1000} seconds, attempting retry or redirect`);
            clearInterval(activityCheckInterval);
            handleTimeout();
        }
    }, 1000); // Check every second
    
    console.log("Inactivity monitoring started");
}

// Track different types of activities
function setupActivityTracking() {
    // Track clicks within the extension
    document.addEventListener('click', () => trackActivity('click'));
    
    console.log("Activity tracking set up for clicks and extension actions");
}

// Function to stop inactivity monitoring
function stopInactivityMonitoring() {
    if (activityCheckInterval) {
        clearInterval(activityCheckInterval);
        activityCheckInterval = null;
        console.log("Inactivity monitoring stopped");
    }
}

// Save state to local storage (for persistence across redirects)
function saveState() {
    const state = {
        currentCustomerIndex,
        currentRefundStep,
        totalRefundSteps,
        processingMultiStep,
        redirectCount,
        currentRetryCount
    };
    localStorage.setItem('refundHandlerState', JSON.stringify(state));
    console.log("State saved:", state);
}

// Load state from local storage
function loadState() {
    const savedState = localStorage.getItem('refundHandlerState');
    if (savedState) {
        try {
            const state = JSON.parse(savedState);
            currentCustomerIndex = state.currentCustomerIndex || 0;
            currentRefundStep = state.currentRefundStep || 0;
            totalRefundSteps = state.totalRefundSteps || 0;
            processingMultiStep = state.processingMultiStep || false;
            redirectCount = state.redirectCount || 0;
            currentRetryCount = state.currentRetryCount || 0;
            console.log("State loaded:", state);
            return true;
        } catch (e) {
            console.error("Error loading state:", e);
            return false;
        }
    }
    return false;
}

// Clear state when done with all refunds
function clearState() {
    localStorage.removeItem('refundHandlerState');
    console.log("State cleared");
}

// Wait for loading indicator to disappear
async function waitForLoadingToComplete() {
    return new Promise(resolve => {
        // Check if loading indicator exists
        const loadingIndicator = document.querySelector(".ui.massive.active.text.loader");
        if (!loadingIndicator) {
            // If no loading indicator is present, resolve immediately
            resolve();
            return;
        }

        console.log("Waiting for page to finish loading...");
        
        // Set up observer to watch for the loading indicator to disappear
        const observer = new MutationObserver((mutations, obs) => {
            if (!document.querySelector(".ui.massive.active.text.loader")) {
                console.log("Page loading completed");
                obs.disconnect();
                // Add a small delay to ensure the UI is fully ready
                setTimeout(() => {
                    resolve();
                }, 500);
            }
        });
        
        // Start observing the document body for changes
        observer.observe(document.body, { 
            childList: true, 
            subtree: true,
            attributes: true,
            attributeFilter: ['class'] 
        });
        
        // Safety timeout to prevent infinite waiting
        setTimeout(() => {
            observer.disconnect();
            console.log("Loading wait timed out, proceeding anyway");
            resolve();
        }, 15000); // 15 second safety timeout
    });
}

// Attempts to bring the extension to the awaiting refunds page
function toAwaitingRefunds() {
    trackActivity('navigation');
    
    const awaitingRefundsPage = Array.from(document.querySelectorAll('.teal.item.tw-flex.tw-w-full.tw-justify-between'))
        .find(button => button.innerText.includes('Awaiting Refunds'));
        
    if (awaitingRefundsPage) {
        awaitingRefundsPage.click();
        console.log("Navigated to Awaiting Refunds page");
    } else {
        console.error('Awaiting Refunds page button not found.');
    }
}

// Function attempts to initiate the refund process as long as there is a valid entry
function beginAwaitingRefunds(x) {
    trackActivity('begin-refund');
    
    const buttons = document.querySelectorAll(".ui.fluid.button.ui.basic.label");
    if (buttons.length === 0) {
        console.error("No refund buttons found");
        return false;
    }
    
    console.log(`Found ${buttons.length} refund buttons`);
    
    // Using the exact pattern from your original script
    if (buttons.length + redirectCount >= 10) {
        if (x % 10 == 0) {
            buttons[0 + redirectCount].click();
        } else if (x % 10 == 1) {
            buttons[1 + redirectCount].click();
        } else if (x % 10 == 2) {
            buttons[2 + redirectCount].click();
        } else if (x % 10 == 3) {
            buttons[3 + redirectCount].click();
        } else if (x % 10 == 4) {
            buttons[4 + redirectCount].click();
        } else if (x % 10 == 5) {
            buttons[5 + redirectCount].click();
        } else if (x % 10 == 6) {
            buttons[6 + redirectCount].click();
        } else if (x % 10 == 7) {
            buttons[7 + redirectCount].click();
        } else if (x % 10 == 8) {
            buttons[8 + redirectCount].click();
        } else if (x % 10 == 9) {
            buttons[9 + redirectCount].click();
        }
        return true;
    } else if (buttons.length > 0) {
        console.log("Clicking first available refund button");
        buttons[0].click();
        return true;
    }
    
    console.error("Could not select a refund button");
    return false;
}

// Function to wait for a specified element to appear in the DOM
function waitForElement(selector, timeout = 20000) {
    return new Promise(resolve => {
        // Check if element already exists
        const element = document.querySelector(selector);
        if (element) {
            resolve(element);
            return;
        }
        
        console.log(`Waiting for element: ${selector}`);
        trackActivity('waiting-for-element');
        
        const observer = new MutationObserver(() => {
            const element = document.querySelector(selector);
            if (element) {
                console.log(`Element found: ${selector}`);
                trackActivity('element-found');
                observer.disconnect();
                resolve(element);
            }
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
        
        // Set a timeout for safety
        setTimeout(() => {
            observer.disconnect();
            console.log(`Timed out waiting for: ${selector}`);
            // We're resolving instead of rejecting to avoid breaking the flow
            resolve(null);
        }, timeout);
    });
}

// Function checks suggested refund method and initiates the refund
function initiateSuggestedRefund() {
    trackActivity('checking-suggested-refund');
    
    // The teal label div is what contains whether the suggested return is store credit or original payment
    const suggestedRefund = document.querySelector(".ui.teal.tiny.label.tw-ml-2");
    if (suggestedRefund) {
        console.log("Found suggested refund method!");

        // Check for the specific icon class inside the div to determine proper refund method
        const icon = suggestedRefund.querySelector("i"); // Assuming the icon stays an <i> tag
        if (icon) {
            // If suggested refund is listed as store credit (bitcoin icon)
            if (icon.classList.contains("bitcoin")) {
                console.log("Suggested method: Store Credit (Bitcoin icon)");
                // Run the store credit refund function
                storeCreditRefund();
                return;
            } 
            // If suggested refund is listed as original payment (credit card icon)
            else if (icon.classList.contains("credit") || icon.classList.contains("card")) {
                console.log("Suggested method: Original Payment (Credit Card icon)");
                // Run the original payment refund function
                originalPaymentRefund();
                return;
            }
            
            // If we got here, the icon class is unknown
            console.log("The icon class does not match known types: " + icon.className);
            // Default to store credit as a fallback
            storeCreditRefund();
        } else {
            console.log("Icon not found inside the suggested refund.");
            // Default to store credit if no icon is found
            storeCreditRefund();
        }
    } else {
        console.log("Suggested refund not found! Defaulting to store credit.");
        // Default to store credit if no suggested refund is found
        storeCreditRefund();
    }
}

function storeCreditRefund() {
    trackActivity('store-credit');
    // Kept it simple as the first button is always store credit
    const storeCredButton = document.querySelector(".ui.blue.tiny.basic.button.tw-mr-0");
    if (storeCredButton) {
        storeCredButton.click();
        console.log("Filled store credit");
    } else {
        console.log("Store credit fill button not found");
    }
}

function originalPaymentRefund() {
    trackActivity('original-payment');
    // Kept simple as well since even if there are multiple original payments the top one is always used
    const buttons = document.querySelectorAll(".ui.blue.tiny.basic.button.tw-mr-0");
    if (buttons.length >= 2) {
        // Clicks the second fill button
        buttons[1].click();
        console.log("Filled original payment");
    } else {
        console.log("Original payment button not found, falling back to store credit");
        storeCreditRefund();
    }
}

function completeRefund() {
    trackActivity('complete-refund');
    const refundButton = document.querySelector(".ui.green.tiny.button");
    if (refundButton) {
        refundButton.click();
        console.log("Completed refund");
    } else {
        console.log("Complete refund button not found");
    }
}

function finalizeRefund() {
    trackActivity('finalize-refund');
    const finalizeButton = document.querySelector("button.ui.green.mini.button:has(i.checkmark.icon)");
    if (finalizeButton) {
        finalizeButton.click();
        console.log("Finalized refund");
    } else {
        console.log("Button to finalize returns not found");
    }
}

// Function to wait for a specified amount of time
function waitFor(ms) {
    return new Promise(resolve => {
        console.log(`Waiting for ${ms}ms`);
        setTimeout(() => {
            resolve();
            trackActivity('wait-complete');
        }, ms);
    });
}

// Clear and then reinitiate timeout countdown
function resetTimeout() {
    clearTimeout(timeoutID); // Clear any existing timeout
    trackActivity('reset-timeout');
    
    timeoutID = setTimeout(() => {
        console.log("Operation timed out, attempting retry or redirect...");
        handleTimeout(); // Handle timeout with retry logic
    }, timeTillTimeout); // Set a new timeout
}

// Handle timeout with retry logic
async function handleTimeout() {
    if (currentRetryCount < maxRetries) {
        currentRetryCount++;
        console.log(`Timeout occurred. Attempting retry ${currentRetryCount} of ${maxRetries}`);
        saveState();
        
        // Wait for 5 seconds before retrying
        await waitFor(5000);
        
        // Restart inactivity monitoring
        startInactivityMonitoring();
        
        // Try to continue from current position
        if (processingMultiStep) {
            console.log(`Retrying multi-step refund at step ${currentRefundStep + 1} of ${totalRefundSteps}`);
            await continueFromCurrentPosition();
        } else {
            console.log("Retrying current refund sequence");
            await executeRefundSequence(currentCustomerIndex);
        }
    } else {
        console.log(`Maximum retries (${maxRetries}) reached. Redirecting and incrementing counter...`);
        currentRetryCount = 0; // Reset retry counter for next attempt
        
        // Increment customer index but don't reset steps 
        // This will skip this problematic refund on next iteration
        currentCustomerIndex++;
        
        saveState();
        timeoutRedirect();
    }
}

// Try to continue from the current position based on state
async function continueFromCurrentPosition() {
    try {
        console.log("Attempting to continue from current position");
        
        // Check if we need to navigate back to awaiting refunds
        if (!document.querySelector('.ui.small.fluid.vertical.steps')) {
            console.log("Not on a refund page, navigating back to awaiting refunds");
            
            // Wait for navigation elements first
            await waitForElement('.teal.item.tw-flex.tw-w-full.tw-justify-between');
            toAwaitingRefunds();
            
            // Wait for refund buttons
            await waitForElement('.ui.fluid.button.ui.basic.label');
            await waitForLoadingToComplete();
            
            // Click the appropriate refund button
            beginAwaitingRefunds(currentCustomerIndex);
            
            // Wait for refund details
            await waitForElement('.ui.teal.tiny.label.tw-ml-2');
            await waitFor(1500);
        }
        
        // Check refund amount before continuing
        const refundAmount = document.querySelector('.sub.header').textContent.trim();
        const number = parseInt(refundAmount.match(/\d+/)[0]);
        if (number >= MAX_REFUND_AMOUNT) {
            console.log(`Refund amount $${number} exceeds maximum allowed ($${MAX_REFUND_AMOUNT})! Incrementing counter and redirecting...`);
            // Increment customer index to skip this refund
            currentCustomerIndex++;
            saveState();
            timeoutRedirect();
            return;
        }
        
        // Now continue with the refund sequence
        await executeRefundSequence(currentCustomerIndex, currentRefundStep);
        
    } catch (error) {
        console.error("Error while trying to continue from current position:", error);
        // Increment counter to skip this problematic refund
        currentCustomerIndex++;
        saveState();
        timeoutRedirect();
    }
}

// Will reload and redirect to awaiting refunds page
async function timeoutRedirect() {
    stopInactivityMonitoring();
    redirectCount++;
    
    console.log(`Redirect ${redirectCount} initiated. Saving state before redirect.`);
    saveState();
    
    location.replace(redirectURL);
}

// Main function to execute a refund sequence
async function executeRefundSequence(n, startStep = 0) {
    try {
        console.log(`Starting refund sequence ${n}, customer index ${currentCustomerIndex}, step ${startStep}`);
        resetTimeout(); // Reset timeout at the start of each sequence
        
        // Skip the navigation and button clicking if we're resuming at a specific step
        if (startStep === 0) {
            if (n != 0) {
                try {
                    await waitForElement('.teal.item.tw-flex.tw-w-full.tw-justify-between'); 
                    await waitForLoadingToComplete();
                } catch (error) {
                    console.error('Error waiting for refund page:', error);
                    handleTimeout();
                    return;
                }
            }

            console.log("Counter = " + n);
            resetTimeout(); // Reset timeout before navigation
            toAwaitingRefunds();
        
            // Wait for refund buttons to appear
            await waitForElement('.ui.fluid.button.ui.basic.label'); 
            await waitForLoadingToComplete();
            resetTimeout(); // Reset timeout before beginning a refund
            
            if (!beginAwaitingRefunds(n)) {
                console.error('Failed to begin awaiting refunds');
                handleTimeout();
                return;
            }
        
            // Wait for refund details to appear
            await waitForElement('.ui.teal.tiny.label.tw-ml-2'); 
            await waitFor(1500); // Give time for everything to stabilize
            resetTimeout(); // Reset timeout before processing refunds
        }
        
        // Get the number of refund steps for this customer
        const refundsStepsElement = document.querySelector('.ui.small.fluid.vertical.steps');
        if (!refundsStepsElement) {
            console.error("Could not find refund steps element");
            handleTimeout();
            return;
        }
        
        const refundLinks = refundsStepsElement.querySelectorAll('a');
        const refundsNum = refundLinks.length;
        processingMultiStep = refundsNum > 1;
        totalRefundSteps = refundsNum;
        
        console.log(`Processing ${refundsNum} refunds for this customer. Multi-step: ${processingMultiStep}`);
        saveState();
        
        // Following your original code pattern exactly
        for (let ii = startStep; ii < refundsNum; ii++) {
            currentRefundStep = ii;
            saveState();
            
            console.log(`Processing refund step ${ii + 1} of ${refundsNum}`);
            resetTimeout();
            
            // This code is for determining if the refund is over the maximum amount
            const refundAmount = document.querySelector('.sub.header').textContent.trim();
            const number = parseInt(refundAmount.match(/\d+/)[0]);
            
            // Check if the refund amount exceeds the maximum
            if (number >= MAX_REFUND_AMOUNT) {
                console.log(`It's over $${MAX_REFUND_AMOUNT}! Skipping Refund!`);
                resetTimeout();
                
                // Increment customer index to skip this refund
                currentCustomerIndex++;
                saveState();
                timeoutRedirect();
                return;
            }

            // For steps after the first one in multi-step refunds, wait for elements to load
            if (ii > 0) {
                console.log("Waiting for refund details in multi-step refund...");
                await waitForElement('.ui.teal.tiny.label.tw-ml-2');
                await waitFor(1500);
                resetTimeout();
            }
            
            // Check for suggested refund method and initiate it
            initiateSuggestedRefund();

            // Store reference to refund amount to check remaining balance later
            const refundAmountLeft = document.querySelector('.sub.header');
            
            // Complete the refund
            await waitForElement('.ui.green.tiny.button');
            completeRefund();
        
            // Finalize the refund
            await waitForElement('button.ui.green.mini.button:has(i.checkmark.icon)');
            finalizeRefund();

            // Wait to see if the payment amount has been met
            await waitFor(1300); // Using your exact value
            
            // If original payment method isn't enough, add store credit
            if (refundAmountLeft && 
                refundAmountLeft.textContent.trim() !== "$0.00 remaining" && 
                refundAmountLeft.textContent.includes('remaining')) {
                
                console.log("Remaining balance detected! Adding store credit to complete the refund.");
                storeCreditRefund();
                
                await waitForElement('.ui.green.tiny.button');
                completeRefund();
        
                await waitForElement('button.ui.green.mini.button:has(i.checkmark.icon)');
                finalizeRefund();
                
                await waitFor(1300);
            }
            
            console.log(`Completed refund step ${ii + 1} of ${refundsNum}`);
            
            // For multi-step refunds, wait for the next step to load
            if (ii < refundsNum - 1 && processingMultiStep) {
                console.log("Waiting for next refund step to load...");
                await waitFor(2000);
                resetTimeout();
            }
        }
        
        // Reset retry count after successful completion
        currentRetryCount = 0;
        
        // Reset refund step tracking
        currentRefundStep = 0;
        totalRefundSteps = 0;
        processingMultiStep = false;
        
        // Move to next customer and wrap around to beginning after refundsPerBatch
        currentCustomerIndex++;
        if (currentCustomerIndex >= refundsPerBatch) {
            console.log(`Completed batch of ${refundsPerBatch} refunds. Restarting from beginning.`);
            currentCustomerIndex = 0;
        }
        
        saveState();
        console.log(`Completed all refund steps. Moving to customer index ${currentCustomerIndex}`);
        
    } catch (error) {
        console.error('Unexpected error in refund sequence:', error);
        // Try retry logic
        handleTimeout();
    }
}

// Function to run the refund process for a specified number of iterations
async function runRefundProcess(iterations) {
    console.log(`Starting refund process for up to ${iterations} total refunds`);
    console.log(`Processing in a loop of the first ${refundsPerBatch} refunds, skipping problematic ones`);
    
    // Try to load state from previous run (useful after redirects)
    const stateLoaded = loadState();
    
    if (stateLoaded) {
        console.log(`Resuming from customer ${currentCustomerIndex}, refund step ${currentRefundStep}`);
    } else {
        // Initialize state for a fresh run
        currentCustomerIndex = 0;
        currentRefundStep = 0;
        currentRetryCount = 0;
        saveState();
    }
    
    // Total count of refunds processed
    let totalRefundsProcessed = 0;
    
    // Process refunds until we've done the requested number or hit an error that stops us
    while (totalRefundsProcessed < iterations) {
        resetTimeout();
        saveState();
        
        console.log(`Starting refund ${totalRefundsProcessed + 1} of ${iterations}: customer index ${currentCustomerIndex}`);
        await executeRefundSequence(currentCustomerIndex);
        
        totalRefundsProcessed++;
        console.log(`Completed refund ${totalRefundsProcessed} of ${iterations}`);
        
        // Add a small delay between customers to avoid overwhelming the server
        await waitFor(350);
    }
    
    console.log(`All ${iterations} refunds completed!`);
    clearState();
}

// Start the extension when the script is loaded
initializeExtension();