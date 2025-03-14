/*
Name: Brice Blanchard
Date: 3/13/2025
Project: Nellis Auction Refund Handler
Version: 1.6
*/

// Initialization
let isRunning = false;
let timeoutID;
let activityTimeoutID;
let redirectCount = 0;
let baseRedirectURL = "https://cargo.nellisauction.com/operations/returns?tab=awaitingProcessing";
let redirectURL = baseRedirectURL;
const refundsToProcess = 200;
const timeTillInactivityTimeout = 15000; // 15 Seconds
const maxRetryAttempts = 3;

// Store the URL parameters if present
function storeURLParameters() {
    const url = new URL(window.location.href);
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    if (startDate && endDate) {
        redirectURL = `https://cargo.nellisauction.com/operations/returns?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&tab=awaitingProcessing`;
        console.log("Using date-specific URL:", redirectURL);
        return true;
    } else {
        redirectURL = baseRedirectURL;
        return false;
    }
}

// Function to wait for an element to appear or disappear with a timeout
function waitForElement(selector, shouldExist = true, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        // Check if element already exists in the desired state
        const checkNow = () => {
            const element = document.querySelector(selector);
            if (shouldExist ? element : !element) {
                return resolve(element);
            }
        };

        // Initial check
        const initialResult = checkNow();
        if (initialResult !== undefined) return initialResult;

        // Set up observer
        const observer = new MutationObserver(() => {
            const result = checkNow();
            if (result !== undefined) {
                observer.disconnect();
                clearTimeout(timeoutHandle);
                resolve(result);
            }
        });

        // Set up timeout
        const timeoutHandle = setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timeout waiting for ${selector} to ${shouldExist ? 'appear' : 'disappear'}`));
        }, timeoutMs);

        // Start observing
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    });
}

// Function to safely wait for a condition with retry
async function safeWaitForElement(selector, shouldExist = true, retryAttempt = 0) {
    try {
        resetActivityTimeout();
        const element = await waitForElement(selector, shouldExist);
        console.log(`Element ${selector} ${shouldExist ? 'found' : 'disappeared'}`);
        return element;
    } catch (error) {
        console.error(`Error waiting for ${selector}:`, error);

        if (retryAttempt < maxRetryAttempts) {
            console.log(`Retrying (${retryAttempt + 1}/${maxRetryAttempts})...`);
            await waitFor(1000);
            return safeWaitForElement(selector, shouldExist, retryAttempt + 1);
        } else {
            console.error("Max retry attempts reached. Redirecting...");
            await timeoutRedirect();
            return null;
        }
    }
}

// Attempts to bring the extension to the awaiting refunds page
async function toAwaitingRefunds() {
    try {
        resetActivityTimeout();

        // Wait for the tabs to be visible
        await safeWaitForElement('.teal.item.tw-flex.tw-w-full.tw-justify-between');

        const awaitingRefundsPage = Array.from(document.querySelectorAll('.teal.item.tw-flex.tw-w-full.tw-justify-between'))
            .find(button => button.innerText.includes('Awaiting Refunds'));

        if (awaitingRefundsPage) {
            console.log("Clicking on Awaiting Refunds tab");
            awaitingRefundsPage.click();
            return true;
        } else {
            console.error("Awaiting Refunds tab not found");
            return false;
        }
    } catch (error) {
        console.error("Error in toAwaitingRefunds:", error);
        return false;
    }
}

// Function attempts to initiate the refund process as long as there is a valid entry
async function beginAwaitingRefunds(x) {
    try {
        resetActivityTimeout();

        // Wait for refund buttons to appear
        await safeWaitForElement('.ui.fluid.button.ui.basic.label');

        const buttons = document.querySelectorAll(".ui.fluid.button.ui.basic.label");
        console.log(`Found ${buttons.length} refund buttons`);

        if (buttons.length === 0) {
            console.log("No refunds to process");
            return false;
        }

        let buttonIndex = 0;

        if (buttons.length + redirectCount >= 12) {
            buttonIndex = (x % 5) + 8 + redirectCount;
            if (buttonIndex >= buttons.length) {
                buttonIndex = 0;
            }
        }

        console.log(`Clicking refund button at index ${buttonIndex}`);
        buttons[buttonIndex].click();
        return true;
    } catch (error) {
        console.error("Error in beginAwaitingRefunds:", error);
        return false;
    }
}

// Function checks suggested refund method and initiates the refund
async function initiateSuggestedRefund() {
    try {
        resetActivityTimeout();

        // Wait for the suggested refund label to appear
        await safeWaitForElement(".ui.teal.tiny.label.tw-ml-2");

        const suggestedRefund = document.querySelector(".ui.teal.tiny.label.tw-ml-2");
        if (suggestedRefund) {
            const icon = suggestedRefund.querySelector("i");
            if (icon) {
                if (icon.classList.contains("bitcoin") || icon.classList.contains("icon")) {
                    return await storeCreditRefund();
                } else if (icon.classList.contains("credit") || icon.classList.contains("card") || icon.classList.contains("icon")) {
                    return await originalPaymentRefund();
                }
            }
        }

        // Default to store credit if can't determine
        return await storeCreditRefund();
    } catch (error) {
        console.error("Error in initiateSuggestedRefund:", error);
        return false;
    }
}

async function storeCreditRefund() {
    try {
        resetActivityTimeout();

        // Wait for the store credit button to appear
        await safeWaitForElement(".ui.blue.tiny.basic.button.tw-mr-0");

        const storeCredButton = document.querySelector(".ui.blue.tiny.basic.button.tw-mr-0");
        if (storeCredButton) {
            console.log("Clicking store credit refund button");
            storeCredButton.click();
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error in storeCreditRefund:", error);
        return false;
    }
}

async function originalPaymentRefund() {
    try {
        resetActivityTimeout();

        // Wait for the refund buttons to appear
        await safeWaitForElement(".ui.blue.tiny.basic.button.tw-mr-0");

        const buttons = document.querySelectorAll(".ui.blue.tiny.basic.button.tw-mr-0");
        if (buttons.length >= 2) {
            console.log("Clicking original payment refund button");
            buttons[1].click();
            return true;
        } else {
            return await storeCreditRefund();
        }
    } catch (error) {
        console.error("Error in originalPaymentRefund:", error);
        return false;
    }
}

async function completeRefund() {
    try {
        resetActivityTimeout();

        // Wait for the green refund button to appear
        await safeWaitForElement(".ui.green.tiny.button");

        const refundButton = document.querySelector(".ui.green.tiny.button");
        if (refundButton) {
            console.log("Clicking complete refund button");
            refundButton.click();
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error in completeRefund:", error);
        return false;
    }
}

async function finalizeRefund() {
    try {
        resetActivityTimeout();

        // Wait for the finalize button to appear
        await safeWaitForElement("button.ui.green.mini.button:has(i.checkmark.icon)");

        const finalizeButton = document.querySelector("button.ui.green.mini.button:has(i.checkmark.icon)");
        if (finalizeButton) {
            console.log("Clicking finalize refund button");
            finalizeButton.click();
            return true;
        }
        return false;
    } catch (error) {
        console.error("Error in finalizeRefund:", error);
        return false;
    }
}

async function executeRefundSequence(n) {
    try {
        if (!isRunning) return false;

        console.log(`Starting refund sequence ${n}`);

        if (n !== 0) {
            await safeWaitForElement('.teal.item.tw-flex.tw-w-full.tw-justify-between');
        }

        await toAwaitingRefunds();

        if (!isRunning) return false;

        const success = await beginAwaitingRefunds(n);
        if (!success) {
            console.log("Failed to begin refund process");
            return false;
        }

        // Wait for the loading indicator to disappear
        await safeWaitForElement('.ui.active.loader', false);
        console.log("Loading completed");

        await waitFor(500);

        if (!isRunning) return false;

        // Make sure the refund steps are loaded
        const stepsContainer = await safeWaitForElement('.ui.small.fluid.vertical.steps');
        if (!stepsContainer) {
            console.error("Refund steps container not found");
            return false;
        }

        const refundSteps = stepsContainer.querySelectorAll('a');
        const refundsNum = refundSteps.length;
        console.log(`Found ${refundsNum} refund steps`);

        if (refundsNum === 0) {
            console.log("No refund steps found, moving to next refund");
            await timeoutRedirect();
            return true;
        }

        for (let ii = 0; ii < refundsNum; ii++) {
            if (!isRunning) return false;

            // Get refund amount
            const refundHeader = document.querySelector('.sub.header');
            if (!refundHeader) {
                console.error("Refund amount header not found");
                continue;
            }

            const refundAmount = refundHeader.textContent.trim();
            const number = parseInt(refundAmount.match(/\d+/)?.[0] || "0");

            console.log(`Refund amount: $${number}`);

            // Skip if over $500
            if (number >= 500) {
                console.log("Refund is over $500! Skipping...");
                resetActivityTimeout();
                await timeoutRedirect();
                continue;
            }

            await initiateSuggestedRefund();

            if (!isRunning) return false;

            const refundAmountLeft = document.querySelector('.sub.header');
            await completeRefund();
            await finalizeRefund();

            if (!isRunning) return false;

            // Check if there's remaining amount and process it
            if (refundAmountLeft &&
                refundAmountLeft.textContent.trim() !== "$0.00 remaining" &&
                refundAmountLeft.textContent.includes('remaining')) {

                console.log("Processing remaining refund amount");
                await storeCreditRefund();
                await completeRefund();
                await finalizeRefund();
            }
        }

        console.log("Refund sequence completed successfully");
        return true;
    } catch (error) {
        console.error("Error in executeRefundSequence:", error);
        await timeoutRedirect();
        return false;
    }
}

async function runRefundProcess(iterations) {
    try {
        let i = 0;
        while (i < iterations && isRunning) {
            resetActivityTimeout();
            console.log(`Starting iteration: ${i + 1}`);

            const success = await executeRefundSequence(i);

            if (!isRunning) {
                console.log("Refund process stopped");
                break;
            }

            if (success) {
                console.log(`Completed iteration: ${i + 1}`);
                i++;
            } else {
                console.log(`Failed iteration: ${i + 1}, retrying...`);
                await timeoutRedirect();
            }
        }

        console.log('All iterations completed or process stopped!');
        isRunning = false;
        chrome.runtime.sendMessage({ status: "completed" });
    } catch (error) {
        console.error("Error in runRefundProcess:", error);
        isRunning = false;
        chrome.runtime.sendMessage({ status: "error", message: error.message });
    }
}

async function timeoutRedirect() {
    try {
        if (!isRunning) return;

        redirectCount++;
        console.log(`Redirect ${redirectCount} initiated to ${redirectURL}`);

        // Clear any existing timeouts
        clearTimeout(timeoutID);
        clearTimeout(activityTimeoutID);

        // Navigate to the redirect URL
        location.replace(redirectURL);

        // Wait for the page to load
        await waitFor(5000);

        // Reset the activity timeout
        resetActivityTimeout();

        console.log(`Redirect ${redirectCount} completed`);
    } catch (error) {
        console.error("Error in timeoutRedirect:", error);
    }
}

function waitFor(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function resetTimeout() {
    clearTimeout(timeoutID);
    timeoutID = setTimeout(() => {
        console.log("Process timeout triggered");
        timeoutRedirect();
    }, 30000); // Keeping the 30-second absolute timeout as a fallback
}

function resetActivityTimeout() {
    // Clear any existing activity timeout
    clearTimeout(activityTimeoutID);

    // Set a new activity timeout
    activityTimeoutID = setTimeout(() => {
        console.log("Inactivity timeout triggered");
        timeoutRedirect();
    }, timeTillInactivityTimeout);
}

// Start the process
function startProcess() {
    if (isRunning) return;

    console.log("Starting refund process...");
    isRunning = true;
    redirectCount = 0;

    // Store URL parameters if present
    storeURLParameters();

    // Navigate to the refund page if not already there
    if (!window.location.href.includes('operations/returns')) {
        location.replace(redirectURL);

        // Wait for navigation and then start the process
        setTimeout(() => {
            resetActivityTimeout();
            runRefundProcess(refundsToProcess);
        }, 3000);
    } else {
        // Already on the correct page, start the process
        resetActivityTimeout();
        runRefundProcess(refundsToProcess);
    }
}

// Stop the process
function stopProcess() {
    console.log("Stopping refund process...");
    isRunning = false;

    // Clear any existing timeouts
    clearTimeout(timeoutID);
    clearTimeout(activityTimeoutID);

    chrome.runtime.sendMessage({ status: "stopped" });
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "start") {
        startProcess();
        sendResponse({ status: "started" });
    } else if (message.action === "stop") {
        stopProcess();
        sendResponse({ status: "stopped" });
    }
    return true;
});

// Initialization - let background script know we're ready
chrome.runtime.sendMessage({ status: "ready" }, (response) => {
    console.log("Content script initialized");
});