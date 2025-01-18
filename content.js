/*
Name: Brice Blanchard
Date: 1/12/2025
Project: Nellis Auction Refund Handler
Version: 1.1
*/

/*
CONTENT LEFT TO IMPLEMENT
    Add implementation of checking for full refund value achieved
        -> If unfilled then click store credit fill button
    Add implementation of clicking refund button
    From there, I should be taken back to the returns page
        -> Wait for load, click awaiting refunds button
    Rinse and repeat (Set max limit for testing purposes)/(Need to build unit testing)
*/
/*
EDGE CASES TO HANDLE
    If original payment isn't enough to fufill amount required -> fill rest with store credit
    If multiple original payment methods are provided -> Always select first listed method (should be handled but needs testing)
    Cargo forced logout should trigger timeout (5 seconds) ** Might need to add specifications to awaiting refund button press to handle timeout prevention
        -> Check login screen HTML
    If there are multiple return receipts under the same customer account, then the script should detect that and fill the other receipts as well
        -> If there is a class containing disabled link step, then that means that there are multiple receipts on the order and that should be handled accordingly
*/
/*
KNOWN ISSUES/ERRORS
    If for some reason the refund is unable to be processed as normal, the script will timeout
        -> The refund will need to be handled manually and the script restarted
            -> Possible handling of issues involves 
                A. Implementing error handling and edge cases to resolve issues 
                B. Initiate a popup or notification to alert manager that intervention is required
                C. Attempt again, upon second failure proceed to next return. 
                Ideal solution combines all 3, implement A, upon failure proceed to C until multiple problematic refunds are detected, then lastly B to alert manager that attention is needed
    Page taking too long to load will cause timeout in script (5 seconds)
*/

// Anything over 200 left for manager
// Credit card is cancelled error

/* Reference Dictionary
    Awaiting Returns Page - "teal item tw-flex tw-w-full tw-justify-between"
    Awaiting Refunds button - "ui.fluid.button.ui.basic.label"
    Suggested Method label - "ui.teal.tiny.label.tw-ml-2"
        Store Credit - "bitcoin class icon"
        Original Payment - "credit card icon" 
    Fill Amount Button - ".ui.blue.tiny.basic.button.tw-mr-0"
    Refund Button - "ui.green.tiny.button"
    Refund Approval Button - "button.ui.green.mini.button:has(i.checkmark.icon)"
*/

// Attempts to bring the extension to the awaiting refunds page
function toAwaitingRefunds() {
    const awaitingRefundsPage = Array.from(document.querySelectorAll('.teal.item.tw-flex.tw-w-full.tw-justify-between'))
    .find(button => button.innerText.includes('Awaiting Refunds'));
    if (awaitingRefundsPage) {
        awaitingRefundsPage.click();
    } else {
        //console.error('Awaiting Refunds page button not found.');
    }
}

// Function attempts to initiate the refund process as long as there is a valid entry
function beginAwaitingRefunds(x) {
    const buttons = document.querySelectorAll(".ui.fluid.button.ui.basic.label");
    if (buttons.length >= 3) {
        if (x % 3 == 0) {
            buttons[0].click();
        } else if (x % 3 == 1) {
            buttons[1].click();
        } else if (x % 3 == 2) {
            buttons[2].click();
        }
    } else {
        buttons[0].click();
    }
}

/*
function beginAwaitingRefunds() {
    const button = document.querySelector(".ui.fluid.button.ui.basic.label");
    if (button) {
        button.click();
        // For Dev Purposes
        //console.log("Approval of returns initiated");
    } else {
        // For Dev Purposes
        //console.log("Failed to initiate valid customer refund");
    }
}
    */

// Function checks suggested refund method and initiates the refund
function initiateSuggestedRefund() {
    // The teal label div is what contains whether the suggested return is store credit or original payment
    const suggestedRefund = document.querySelector(".ui.teal.tiny.label.tw-ml-2");
    if (suggestedRefund) {
        // For Dev Purposes
        //console.log("Found suggested refund method!");

        // Check for the specific icon class inside the div to determine proper refund method
        const icon = suggestedRefund.querySelector("i"); // Assuming the icon stays an <i> tag (Needs further verification)
        if (icon) {
            // If suggested refund is listed as store credit
            if (icon.classList.contains("bitcoin", "icon")) {
                // Run the store credit refund function
                storeCreditRefund();
            // If suggested refund is listed as original payment
            } else if (icon.classList.contains("credit", "card", "icon")) {
                // Run the original payment refund function
                originalPaymentRefund();
            } else {
                // For Dev Purposes
                //console.log("The icon class does not match Bitcoin or Credit Card.");
            }
        } else {
            // For Dev Purposes
            //console.log("Icon not found inside the suggested refund.");
        }
        // completeRefund();
    } else {
        // For Dev Purposes
        //console.log("Suggested refund not found!");
    }
}

function storeCreditRefund() {
    // Kept it simple as the first button is always store credit
    const firstFillButton = document.querySelector(".ui.blue.tiny.basic.button.tw-mr-0");
    if (firstFillButton) {
        firstFillButton.click();
        // For Dev Purposes
        //console.log("Filled store credit");
    } else {
        // For Dev Purposes
        //console.log("Store credit fill button not found");
    }
}

function originalPaymentRefund() {
    // Kept simple as well since even if there are multiple original payments the top one is always used, so this selects the second fill button
    const buttons = document.querySelectorAll(".ui.blue.tiny.basic.button.tw-mr-0");
    if (buttons.length >= 2) {
        // Clicks the second fill button
        buttons[1].click();
        // For Dev Purposes
        //console.log("Filled original payment");
    } else {
        // For Dev Purposes
        //console.log("Original payment button not found");
    }
}

function completeRefund() {
    const refundButton = document.querySelector(".ui.green.tiny.button");
    if (refundButton) {
        refundButton.click();
    } else {
        //console.log("Complete refund button not found")
    }
}

function finalizeRefund() {
    const finalizeButton = document.querySelector("button.ui.green.mini.button:has(i.checkmark.icon)");
    if (finalizeButton) {
        finalizeButton.click();
    } else {
        //console.log("Button to finalize returns not found")
    }
}

function waitForElement(selector) {
    return new Promise(resolve => {
        const observer = new MutationObserver(() => {
            const element = document.querySelector(selector);
            if (element) {
                observer.disconnect();
                resolve(element);
            }
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
    });
}
    let count = 0;
    async function executeRefundSequence(n) {
        
        if (count != 0) {
            await waitForElement('.teal.item.tw-flex.tw-w-full.tw-justify-between'); 
        }
        console.log(count);
        count++;
        toAwaitingRefunds();
    
        await waitForElement('.ui.fluid.button.ui.basic.label'); 
        beginAwaitingRefunds(n);
    
        await waitForElement('.ui.teal.tiny.label.tw-ml-2'); 
        initiateSuggestedRefund();

        // If original payment method isn't enough, add store credit
        const refundAmount = document.querySelector('.sub.header');
        if (refundAmount && refundAmount.textContent.trim() !== "$0.00 remaining") {
            storeCreditRefund();
        }
    
        await waitForElement('.ui.green.tiny.button'); 
        completeRefund();
    
        //await waitForElement('button.ui.green.mini.button:has(i.checkmark.icon)');
        //finalizeRefund();
    }
    
    // Function to run the refund process for a specified number of iterations
    async function runRefundProcess(iterations) {
        for (let i = 0; i < iterations; i++) {
            console.log(`Starting iteration: ${i + 1}`);
            await executeRefundSequence(i); // Wait for the sequence to complete before the next iteration
            console.log(`Completed iteration: ${i + 1}`);
        }
        console.log('All iterations completed!');
    }
    
    // Start the refund process for 5 iterations
    runRefundProcess(3);
