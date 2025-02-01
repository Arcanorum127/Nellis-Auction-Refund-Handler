/*
Name: Brice Blanchard
Date: 1/30/2025
Project: Nellis Auction Refund Handler
Version: 2.1
*/

// Initialization
let timeoutID;
let redirectCount = 0;
const redirectURL = "https://cargo.nellisauction.com/operations/returns?tab=awaitingProcessing";
const refundsToProcess = 200;
const timeTillTimeout = 30000; // 30 Seconds

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
    if (buttons.length + redirectCount >= 5) {
        if (x % 5 == 0) {
            buttons[0 + redirectCount].click();
        } else if (x % 5 == 1) {
            buttons[1 + redirectCount].click();
        } else if (x % 5 == 2) {
            buttons[2 + redirectCount].click();
        } else if (x % 5 == 3) {
            buttons[3 + redirectCount].click();
        } else if (x % 5 == 4) {
            buttons[4 + redirectCount].click();
        }
    } else {
        buttons[0].click();
    }
}

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
    const storeCredButton = document.querySelector(".ui.blue.tiny.basic.button.tw-mr-0");
    if (storeCredButton) {
        storeCredButton.click();
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
        storeCreditRefund();
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
    async function executeRefundSequence(n) {
        if (n != 0) {
            await waitForElement('.teal.item.tw-flex.tw-w-full.tw-justify-between'); 
        }

        //console.log("Counter = " + n)
        toAwaitingRefunds();
    
        // while loop optimization for multiple refunds?
        await waitForElement('.ui.fluid.button.ui.basic.label'); 
        beginAwaitingRefunds(n);

        //const multipleRefunds = Array.from(document.querySelectorAll('.disabled.link.step'));
    
        await waitForElement('.ui.teal.tiny.label.tw-ml-2'); 
        await waitFor(1500);

        // This code runs through the refunds and will repeat if there are multiple refunds for one customer
        const refundsNum = document.querySelector('.ui.small.fluid.vertical.steps').querySelectorAll('a').length;
        //console.log(refundsNum);
        for (let ii = 0; ii < refundsNum; ii++) {

            // This code is for determining if the refund is over $300, if it is, the extension is terminated.
            // Future update should be to skip over it till a manager can finish these or till permission is given.
            const refundAmount = document.querySelector('.sub.header').textContent.trim();
            const number = parseInt(refundAmount.match(/\d+/)[0]);
            // Checking if the amount is over 800
            if (number >= 800) {
                console.log("It's over $800! Skipping Refund!");
                resetTimeout();
                timeoutRedirect();
                //throw new Error("It's over $800! Please get a manager.");
            }

            initiateSuggestedRefund();


            // If the suggested method is original payment, yet there is only a store credit button, then fill store credit and proceed
            const refundAmountLeft = document.querySelector('.sub.header');
            await waitForElement('.ui.green.tiny.button'); 
            completeRefund();
        
            await waitForElement('button.ui.green.mini.button:has(i.checkmark.icon)');
            finalizeRefund();

            // Waiting long enough to determine if the payment amount has been met
            await waitFor(1300); //THIS VALUE CAN CHANGE, it's just 1500 is the safe side

            
            // If original payment method isn't enough, add store credit
            if (refundAmountLeft && refundAmountLeft.textContent.trim() !== "$0.00 remaining" && refundAmountLeft.textContent.includes('remaining')) {
                //console.log("store credit needed");
                storeCreditRefund();
                await waitForElement('.ui.green.tiny.button'); 
                completeRefund();
        
                await waitForElement('button.ui.green.mini.button:has(i.checkmark.icon)');
                finalizeRefund();
            }
            
        }
    }

    // Function to wait for a specified amount of time
    function waitFor(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // Function to run the refund process for a specified number of iterations
    async function runRefundProcess(iterations) {
        for (let i = 0; i < iterations; i++) {
            resetTimeout();
            console.log(`Starting iteration: ${i + 1}`);
            await executeRefundSequence(i); // Wait for the sequence to complete before the next iteration
            console.log(`Completed iteration: ${i + 1}`);
            await waitFor(350); // Hopefully enough time to negate 429 Errors
        }
        console.log('All iterations completed!');
    }

    // Will reload and redirect to awaiting refunds page
    async function timeoutRedirect() {
        redirectCount++;
        location.replace(redirectURL);
        await waitFor(7000); // 7 Seconds
        resetTimeout();
        console.log("Redirect " + redirectCount + " Initiated.");
    }

    // Clear and then reinitiate timeout countdown
    function resetTimeout() {
        clearTimeout(timeoutID); // Clear any existing timeout
        timeoutID = setTimeout(() => {
            timeoutRedirect(); // Redirect after the timeout
        }, timeTillTimeout); // Set a new timeout
    }

    // Every time a click is detected, reset the timeout (should include extension clicks)
    // Actually may not need, may just want to proc if any refund process takes longer than 30 seconds?
    //window.addEventListener("click", resetTimeout);
    
    // Start the refund process for n iterations
    runRefundProcess(refundsToProcess);

    // Alternatively I could do while redirectCount <= n if I want it to keep running till it runs into n refunds that require manual approval
