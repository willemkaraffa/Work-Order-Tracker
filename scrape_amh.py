"""
scrape_amh.py  --  AMH work-order capture via headless Microsoft EDGE.

AMH's portal no longer supports Chromium-engine browsers driven as a generic
browser; real Edge passes. This logs in with Selenium/Edge, captures the Bearer
token from the network performance log, then calls AMH's REST API
(app.amh.com/services-api/api/Order/Query) directly for structured JSON. Tiny
browser surface (login + one list load); all WO data comes from the API.

Selenium/Edge login + token capture; extraction builds a full tracker WO object
per WO. Field map verified live 2026-06-22 (see ref-amh-orderquery-api memory).

stdin : JSON array of WO numbers  e.g. ["9765734","9762158"]
stdout: JSON object { "<woNum>": { ok, wo, warnings } }
env   : AMH_EMAIL / AMH_PASSWORD (required for fresh login)
        EDGE_BINARY / EDGE_DRIVER (optional explicit paths; for packaged app)
"""
from __future__ import annotations
import datetime, json, os, re, sys, time, urllib.request
from pathlib import Path
from typing import Dict, List, Optional

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.edge.options import Options
from selenium.webdriver.edge.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import NoSuchElementException

SCRIPT_DIR  = Path(os.path.dirname(os.path.abspath(__file__)))
EMAIL       = os.environ.get("AMH_EMAIL")
PASSWORD    = os.environ.get("AMH_PASSWORD")
LOGIN_URL   = "https://www.amh.com/login"
WO_LIST_URL = "https://www.amh.com/vendor-admin-orders?tabId=AllOpen"
API_BASE    = "https://app.amh.com/services-api/api"
WO_LINK_BASE = "https://www.amh.com/my-amh/vendor-user-orders/"

_DEFAULT_EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0  # CREATE_NO_WINDOW


# ── driver ────────────────────────────────────────────────────────────────────

def _edge_binary() -> Optional[str]:
    cand = os.environ.get("EDGE_BINARY") or _DEFAULT_EDGE
    return cand if cand and os.path.exists(cand) else None


def _edge_driver_path() -> Optional[str]:
    # Prefer an explicit/bundled msedgedriver.exe so the packaged app stays
    # offline. Else return None and let Selenium Manager auto-resolve it.
    for cand in (os.environ.get("EDGE_DRIVER"),
                 str(SCRIPT_DIR / "msedgedriver.exe"),
                 str(SCRIPT_DIR / "msedgedriver")):
        if cand and os.path.exists(cand):
            return cand
    return None


def make_driver():
    opts = Options()
    # NO HEADLESS. Edge 150 (Chromium 150) REMOVED --headless=old (dropped in Chromium 132),
    # so --headless=new is the only headless mode -- and it paints the click-through
    # DirectComposition "screen blocker" overlay that NO gpu flag suppresses (--disable-gpu
    # and --disable-gpu-compositing both tried; overlay persisted). The reference AMH scraper
    # avoids it only because it drives CHROME (different headless surface); we must use Edge
    # (AMH blocks generic Chrome). So run a REAL, HEADED Edge window positioned far OFF-SCREEN:
    # no headless mode -> no headless surface, and an off-screen window is invisible while it
    # logs in + captures the perf-log token exactly as before.
    opts.add_argument("--window-position=-32000,-32000")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument("--disable-extensions")
    # Persistent Edge profile so the AMH auth cookie survives runs — without it
    # every capture is a fresh profile and pays the full ~30s iframe login. The
    # packaged app passes EDGE_PROFILE (a writable userData dir); dev falls back
    # to a repo-local dir.
    profile_dir = os.environ.get("EDGE_PROFILE") or str(SCRIPT_DIR / ".edge-amh-profile")
    opts.add_argument(f"--user-data-dir={profile_dir}")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    opts.set_capability("ms:loggingPrefs", {"performance": "ALL"})
    binary = _edge_binary()
    if binary:
        opts.binary_location = binary
    # Always route through a Service so we can suppress the msedgedriver console
    # window on Windows (creation_flags=CREATE_NO_WINDOW). A bundled driver keeps
    # the packaged app offline; an empty-path Service still lets Selenium Manager
    # (selenium 4.6+) auto-resolve the binary. Without this, the no-driver fallback
    # spawned msedgedriver with a visible blank console window.
    driver_path = _edge_driver_path()
    service = Service(driver_path) if driver_path else Service()
    if sys.platform == "win32":
        service.creation_flags = _NO_WINDOW
    return webdriver.Edge(service=service, options=opts)


# ── login + token capture ──────────────────────────────────────────────────────

def login_and_get_token(driver) -> str:
    print("[LOGIN] Navigating to AMH login page...", file=sys.stderr)
    driver.get(LOGIN_URL)
    time.sleep(5)

    cur = driver.current_url
    if "/login" not in cur and "b2clogin" not in cur:
        print("[LOGIN] Existing AMH session detected.", file=sys.stderr)
    else:
        if not EMAIL or not PASSWORD:
            raise RuntimeError("AMH_EMAIL / AMH_PASSWORD not set; cannot log in.")
        print("[LOGIN] Switching to login iframe...", file=sys.stderr)
        iframe = WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.ID, "loginIframe")))
        driver.switch_to.frame(iframe)
        time.sleep(2)

        email_input = WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.ID, "signInName")))
        email_input.clear(); email_input.send_keys(EMAIL); time.sleep(0.4)
        pwd_input = driver.find_element(By.ID, "password")
        pwd_input.clear(); pwd_input.send_keys(PASSWORD); time.sleep(0.4)

        print("[LOGIN] Submitting...", file=sys.stderr)
        try:
            submit = driver.find_element(By.ID, "next")
        except NoSuchElementException:
            submit = driver.find_element(By.XPATH,
                "//button[@type='submit'] | //input[@type='submit']")
        submit.click()
        driver.switch_to.default_content()

        for _ in range(25):
            time.sleep(1)
            low = driver.current_url.lower()
            if "login" not in low and "b2clogin" not in low:
                break

    # After login the session is authenticated, but the SPA may still be acquiring its API
    # token when we first scan -> the Bearer isn't in the log yet. This is the cold-login
    # race: a WARM load catches it (proven -- an app 2nd attempt on a warm profile succeeds
    # via this same scan). So RE-NAVIGATE the WO list within this already-authenticated
    # session and re-scan, a few times, instead of one shot -- no re-login needed, it just
    # gives the token time to be ready and fires fresh authed requests each pass.
    token = None
    seen_requests = 0
    for pass_n in range(5):
        print(f"[LOGIN] Loading WO list to trigger authenticated API requests (pass {pass_n + 1})...",
              file=sys.stderr)
        driver.get(WO_LIST_URL)
        time.sleep(6)
        for entry in driver.get_log("performance"):
            try:
                msg = json.loads(entry["message"])["message"]
                method = msg.get("method")
                # Scan BOTH events: a cross-origin Authorization (www.amh.com page ->
                # app.amh.com API) can land in requestWillBeSentExtraInfo, not the main event.
                if method == "Network.requestWillBeSent":
                    seen_requests += 1
                    headers = msg["params"]["request"].get("headers", {})
                elif method == "Network.requestWillBeSentExtraInfo":
                    headers = msg["params"].get("headers", {})
                else:
                    continue
                auth = headers.get("Authorization") or headers.get("authorization") or ""
                if auth.startswith("Bearer "):
                    token = auth
                    break
            except Exception:
                pass
        if token:
            break

    if not token:
        raise RuntimeError(
            "Could not capture Bearer token from network logs "
            f"(url={driver.current_url!r}, requests_seen={seen_requests}). "
            "A /login or b2clogin url means the credentials failed; otherwise no "
            "authenticated API request surfaced a Bearer across the retries.")
    print(f"[LOGIN] Bearer token captured ({len(token)} chars).", file=sys.stderr)
    return token


# ── API ─────────────────────────────────────────────────────────────────────

def api_get(path: str, token: str, params: Optional[Dict[str, str]] = None):
    url = f"{API_BASE}/{path}"
    if params:
        qs = "&".join(f"{k}={urllib.request.quote(str(v))}" for k, v in params.items())
        url = f"{url}?{qs}"
    req = urllib.request.Request(url, headers={
        "Authorization": token, "Accept": "application/json",
        "Origin": "https://www.amh.com", "Referer": "https://www.amh.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def api_post(path: str, token: str, body: dict):
    url = f"{API_BASE}/{path}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Authorization": token, "Accept": "application/json",
        "Content-Type": "application/json",
        "Origin": "https://www.amh.com", "Referer": "https://www.amh.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    })
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def today_api_value() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT04:00:00.000Z")


def as_order_list(resp) -> list:
    """Normalize an API response to a list of order envelopes. A bare list passes
    through; a paging wrapper is unwrapped by the first list-valued key we know."""
    if isinstance(resp, list):
        return resp
    if isinstance(resp, dict):
        for k in ("orders", "items", "data", "results", "value"):
            v = resp.get(k)
            if isinstance(v, list):
                return v
    return []


def index_orders(orders: list, target: Dict[str, dict]) -> None:
    """Key each envelope by its stripped WO number into target. setdefault: an
    earlier feed (Order/Query, the fresher active set) wins over a later one."""
    for item in orders:
        o = item.get("order") or item
        name = re.sub(r"^WO-", "", normalize_text(o.get("name")), flags=re.I).strip()
        if name:
            target.setdefault(name, item)


def fetch_admin_order(token: str, wo_num: str) -> Optional[dict]:
    """Look up a single WO in the admin Posted feed by WO-number search. Order/Query
    only returns the ~100 most-recent orders, so old paid WOs age out; this feed
    reaches them. Request shape captured live 2026-07-13 (see ref-amh-orderquery-api):
    POST Order/VendorAdminOrders {type,query,paging} -> {orders,filterData,totalCount}.
    query=<wo#> filters server-side, so no paging loop is needed for a targeted lookup.
    Returns the envelope whose order.name matches exactly, or None."""
    body = {"type": "Posted", "query": wo_num,
            "paging": {"pageIndex": 0, "pageSize": 50, "sortBy": "name", "sortAscending": False}}
    try:
        resp = api_post("Order/VendorAdminOrders", token, body)
    except Exception as exc:
        print(f"[API] VendorAdminOrders query {wo_num} failed ({exc}).", file=sys.stderr)
        return None
    for item in as_order_list(resp):
        o = item.get("order") or item
        name = re.sub(r"^WO-", "", normalize_text(o.get("name")), flags=re.I).strip()
        if name == wo_num:
            return item
    return None


# ── extraction helpers ─────────────────────────────────────────────────────────

def normalize_text(value: object) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def choose_options_for_bid(bid: Optional[dict]) -> List[dict]:
    if not bid:
        return []
    options = bid.get("options", []) or []
    approved = [o for o in options if o.get("isApproved")]
    if approved:
        return approved
    preferred = [o for o in options if o.get("isPreferred")]
    return preferred if preferred else options


def service_display_name(service: dict, remedy_map: dict) -> str:
    remedy = service.get("remedyInstance", {}) or {}
    name = normalize_text(remedy.get("description")) or normalize_text(remedy.get("name"))
    if name:
        return name
    rid = normalize_text(service.get("remedyInstanceId"))
    mapped = (remedy_map or {}).get(rid, {}) or {}
    return (normalize_text(mapped.get("description"))
            or normalize_text(mapped.get("name"))
            or normalize_text(service.get("serviceId")))


def extract_bids(order: dict, remedy_map: dict):
    """Return (bidItems, bidTotal) from the APPROVED bid only (no approved bid ->
    empty); line items deduped by name."""
    bids = order.get("bids") or []
    approved = [b for b in bids
                if normalize_text(b.get("statusName")).lower() == "approved"]
    # Approved-only: never fall back to a Draft/Pending/Rejected bid. Importing a
    # non-approved amount silently mismatched the eventual approved total; no
    # approved bid -> empty items -> the "no bid items" warning surfaces the WO.
    bid = approved[0] if approved else None

    items: List[Dict] = []
    total = 0.0
    for option in choose_options_for_bid(bid):
        for service in (option.get("services") or []):
            name = service_display_name(service, remedy_map)
            qty        = float(service.get("quantity")  or 0) or 1.0
            unit_price = float(service.get("unitPrice") or 0)
            vendor_tax = float(service.get("vendorTax") or 0)
            if not name or unit_price <= 0:
                continue
            if any(x["name"].lower() == name.lower() for x in items):
                continue
            # Keep vendorTax per line (the reference amh_remittance_scraper.py uses it):
            # AMH pays qty*unitPrice + vendorTax, so the remittance reconcile needs the
            # per-line tax, not just the inclusive bidTotal. price stays the pre-tax unit.
            items.append({"name": name, "qty": qty, "price": unit_price, "vendorTax": round(vendor_tax, 2)})
            total += round(qty * unit_price + vendor_tax, 2)
    return items, round(total, 2)


_PLUMB_RE = re.compile(r"plumb|shower|tub|toilet|drain|faucet|sink|sewer|leak", re.I)
_HVAC_RE  = re.compile(r"hvac|heat|cool|air\s*condition|furnace|thermostat|ventilation", re.I)


def extract_issues(issue_instances: dict):
    """Return (type, notes) from condititionIssueInstances [sic]. Scans ALL
    issues' category + notes for plumbing/HVAC signals: both -> dual job. Only
    HVAC + Plumbing are real trades; never 'Other' (undetermined -> Plumbing,
    the company's primary trade). order.typeName is the WO category, not trade."""
    issues = list((issue_instances or {}).values())
    has_p = has_h = False
    note_blocks = []
    for ci in issues:
        cat = normalize_text(ci.get("conditionIssueCategoryName"))
        body = normalize_text(ci.get("notes"))
        title = normalize_text(ci.get("conditionIssueName"))
        text = cat + " " + body
        if _PLUMB_RE.search(text): has_p = True
        if _HVAC_RE.search(text):  has_h = True
        if body:
            note_blocks.append((title + ": " + body) if title else body)
        elif title:
            note_blocks.append(title)
    wo_type = "Plumbing+HVAC" if (has_p and has_h) else "HVAC" if has_h else "Plumbing"
    return wo_type, "\n\n".join(note_blocks)


def extract_contacts(customers: list):
    contacts = []
    for c in (customers or []):
        name = normalize_text((c.get("firstName") or "") + " " + (c.get("lastName") or ""))
        phone = normalize_text(c.get("phone") or c.get("homePhone") or c.get("otherPhone"))
        if not name and not phone:
            continue
        contacts.append({
            "name": name, "phone": phone,
            "email": normalize_text(c.get("email")),
            "primary": bool(c.get("isPrimary")),
        })
    # Primary first so contacts[0] is the primary contact.
    contacts.sort(key=lambda x: not x["primary"])
    return contacts


# ── per-WO assembly ─────────────────────────────────────────────────────────

def build_wo(item: dict) -> dict:
    order = item.get("order") or item
    prop  = order.get("property") or {}
    addr  = prop.get("address") or {}

    wo_type, notes = extract_issues(item.get("condititionIssueInstances"))
    contacts = extract_contacts(item.get("customers"))
    primary  = contacts[0] if contacts else None
    bid_items, bid_total = extract_bids(order, item.get("remedyInstances"))

    warnings = []
    if not bid_items:
        statuses = sorted({normalize_text(b.get("statusName")) for b in (order.get("bids") or [])})
        if statuses:
            warnings.append("no bid items (bid statuses: " + ", ".join(statuses) + ")")

    wo = {
        "woId":        normalize_text(order.get("name")),
        "address":     normalize_text(addr.get("street")),
        "city":        normalize_text(addr.get("city")),
        "state":       normalize_text(addr.get("state")),
        "zip":         normalize_text(addr.get("zipCode")),
        "propertyId":  normalize_text(prop.get("propertyNo")),
        "status":      normalize_text(order.get("statusName")),
        "subStatus":   normalize_text(order.get("subStatusName")),
        "type":        wo_type,
        "notes":       notes,
        "phone":       primary["phone"] if primary else "",
        "contactName": primary["name"]  if primary else "",
        "contacts":    contacts,
        "bidItems":    bid_items,
        "bidAmount":   f"{bid_total:.2f}" if bid_total else "",
        "portalLink":  (WO_LINK_BASE + order.get("id") + "?tabId=general") if order.get("id") else "",
    }
    return {"ok": True, "wo": wo, "warnings": warnings}


# ── main ──────────────────────────────────────────────────────────────────────

# statusName values excluded from the all-open bulk capture. "Posted" was here, but
# Posted = work done, AWAITING INVOICING -- exactly the WOs the invoicing flow needs in
# the app. Excluding it meant a WO that reached Posted before a bulk scan (e.g. 9797636)
# was silently dropped and had to be hand-entered. Now bulk imports Posted too; only
# truly closed/cancelled WOs are skipped. (Known WOs update in place without tab regress;
# only NEW Posted WOs import.)
ALL_OPEN_SENTINEL = "__ALL_OPEN__"
_CLOSED_STATUSES = {"completed", "canceled", "cancelled"}


def main():
    raw = sys.stdin.read().strip()
    wo_numbers: List[str] = json.loads(raw) if raw else []
    if not wo_numbers:
        print("{}", flush=True)
        return
    all_open = ALL_OPEN_SENTINEL in wo_numbers

    print(f"[API] Capturing {'ALL OPEN' if all_open else len(wo_numbers)} WO(s)...", file=sys.stderr)
    driver = make_driver()
    try:
        token = login_and_get_token(driver)
    finally:
        try: driver.quit()
        except Exception: pass

    print("[API] Fetching Order/Query...", file=sys.stderr)
    orders = as_order_list(api_get("Order/Query", token, {"today": today_api_value(), "loadFiles": "false"}))
    print(f"[API] Order/Query: {len(orders)} order(s).", file=sys.stderr)

    order_map: Dict[str, dict] = {}
    index_orders(orders, order_map)

    # Old paid WOs age out of Order/Query (~100 most-recent only). Targeted lookups below
    # fall back to fetch_admin_order (VendorAdminOrders WO-number search) to reach them.
    # The all-open bulk path stays on Order/Query so it isn't flooded with 300+ historical
    # Posted/Canceled WOs.

    results = {}
    if all_open:
        # Every "All Open" WO that is not Completed/Canceled, keyed by WO number.
        for name, item in order_map.items():
            o = item.get("order") or item
            if normalize_text(o.get("statusName")).lower() in _CLOSED_STATUSES:
                continue
            try:
                results[name] = build_wo(item)
            except Exception as exc:
                results[name] = {"ok": False, "error": f"extract failed: {exc}"}
        print(f"  all-open: {len(results)} WO(s)", file=sys.stderr)
    else:
        for wo_num in wo_numbers:
            stripped = re.sub(r"^WO-", "", wo_num, flags=re.I).strip()
            item = order_map.get(stripped) or fetch_admin_order(token, stripped)
            if not item:
                results[wo_num] = {"ok": False,
                                   "error": f"WO {stripped} not found in AMH active or admin (Posted) orders."}
                continue
            try:
                results[wo_num] = build_wo(item)
                w = results[wo_num]["wo"]
                print(f"  {wo_num}: type={w['type']} items={len(w['bidItems'])} ${w['bidAmount']}",
                      file=sys.stderr)
            except Exception as exc:
                results[wo_num] = {"ok": False, "error": f"extract failed: {exc}"}

    print(json.dumps(results), flush=True)


if __name__ == "__main__":
    main()
