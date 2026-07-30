Work Order Capture — Chrome Extension
======================================
Universal work order capture from any web portal.

INSTALL
-------
1. Open Chrome and go to:  chrome://extensions
2. Enable "Developer mode" (toggle, top-right corner)
3. Click "Load unpacked"
4. Select this folder (wo-extension)
5. The green WO icon appears in your toolbar

HOW TO USE
----------
METHOD 1 — Right-click capture (fastest):
  1. Go to any portal (AMH, AppFolio, Buildium, etc.)
  2. Select any text on the page (address, tech name, etc.)
  3. Right-click → WO Capture → Set as [Field]
  4. A green toast confirms the field was captured
  5. Repeat for each field you want
  6. Click the extension icon → review fields → "Add to Tracker"

METHOD 2 — Manual entry:
  1. Click the extension icon
  2. Type or paste values into the fields directly
  3. Click "Add to Tracker" or "Save to List"

TABS
----
Capture  — Fill in fields and submit work orders
Saved    — View, edit, or remove saved work orders
Export   — Download CSV or copy JSON for bulk import
Help     — Quick reference guide

EXPORTING TO THE TRACKER
-------------------------
Option A (CSV Import - manual):
  1. Go to Export tab → Download CSV
  2. Open your Work Order Tracker
  3. Use the CSV import feature (if enabled)

Option B (JSON - bulk):
  1. Go to Export tab → Copy JSON
  2. Paste into wo-data.json in %APPDATA%\Work Order Tracker\
     (merge the arrays manually or replace the orders array)

FIELDS SUPPORTED
----------------
  Address, PM / Client, Technician, Type, Priority,
  Status, Invoice #, Date Created, Notes

WORKS ON ANY PORTAL
-------------------
  AMH 4Services · AppFolio · Buildium · Propertyware
  RentManager · Any website with text you can select
