# Nellis-Auction-Refund-Handler
refundsToProcess determines the amount of refunds that should be attempted 
timeTillTimeout determines how long the extension should wait before declaring a return as problematic and skipping it

Current Concerns:
    When I am redirected to the awaiting refunds page, will it negate the currently injected content scrript?
    If so how will this affect the refund handler, further tests are required.



ERRORS:
*Both Errors should be partially addressed if the skip works)
    Cannot read properties of null (reading 'slice')
        Console Error: performance-BDij6WjE.js:4 
        POST https://cargo.nellisauction.com/api/refunds/creditCard 500 (Internal Server Error)

    Too Many Requests 
        429 Error


 Reference Dictionary
    Awaiting Returns Page - "teal item tw-flex tw-w-full tw-justify-between"
    Awaiting Refunds button - "ui.fluid.button.ui.basic.label"
    Suggested Method label - "ui.teal.tiny.label.tw-ml-2"
        Store Credit - "bitcoin class icon"
        Original Payment - "credit card icon" 
    Fill Amount Button - ".ui.blue.tiny.basic.button.tw-mr-0"
    Refund Button - "ui.green.tiny.button"
    Refund Approval Button - "button.ui.green.mini.button:has(i.checkmark.icon)"
