'use strict';
// ONE source for the AMH vendor route. amh-pw-login.js and amh-pw-token.js each held
// their own copy of this URL; one copy drifted and produced a blank re-login window
// (2026-08-17). Both now require this file, so the route can only change in one place.
//
// The /my-amh/ prefix is what makes the route authed: the bare /vendor-admin-orders
// path falls through to the PUBLIC marketing site and fires no authed request, so no
// Bearer surfaces. https://www.amh.com/let-yourself-in is the RESIDENT self-tour page
// (renders "No viewings to display", no login form), NOT a vendor login.
const VENDOR_ORDERS_URL = 'https://www.amh.com/my-amh/vendor-admin-orders?tabId=AllOpen';
const LOGIN_PATH_MARKER = '/login';   // what a logged-out bounce lands on

module.exports = { VENDOR_ORDERS_URL, LOGIN_PATH_MARKER };
