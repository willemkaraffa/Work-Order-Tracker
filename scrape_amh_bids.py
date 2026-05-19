"""
scrape_amh_bids.py  –  called by scrape-existing-amh.js
Uses the EXACT same login, token-capture, and item-extraction logic as
amh_remittance_scraper.py.  Functions copied verbatim from that file.

Reads WO numbers from stdin (JSON array), outputs JSON to stdout.
Usage:
    echo '["9688774","9612779"]' | python scrape_amh_bids.py
"""

from __future__ import annotations
import importlib, json, os, re, subprocess, sys, time, urllib.request, zipfile
from pathlib import Path
from typing import Dict, List, Optional

# ── dependency bootstrap (same as remittance scraper) ─────────────────────────

def ensure_package(module_name: str, pip_name: Optional[str] = None) -> None:
    try:
        importlib.import_module(module_name)
    except ImportError:
        pkg = pip_name or module_name
        print(f"[SETUP] Installing {pkg} ...", file=sys.stderr)
        subprocess.check_call([sys.executable, "-m", "pip", "install", pkg,
                               "--quiet", "--no-warn-script-location"])

ensure_package("selenium")
ensure_package("webdriver_manager", "webdriver-manager")

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import NoSuchElementException
from webdriver_manager.chrome import ChromeDriverManager

# ── constants (same as remittance scraper) ────────────────────────────────────

SCRIPT_DIR  = Path(os.path.dirname(os.path.abspath(__file__)))
EMAIL       = os.environ.get("AMH_EMAIL")    or "dgamble4084@gmail.com"
PASSWORD    = os.environ.get("AMH_PASSWORD") or "Smart123#"
LOGIN_URL   = "https://www.amh.com/login"
WO_LIST_URL = "https://www.amh.com/vendor-admin-orders?tabId=AllOpen"
API_BASE    = "https://app.amh.com/services-api/api"

# ── ChromeDriver setup (copied verbatim from remittance scraper) ──────────────

def get_windows_chrome_path() -> Optional[str]:
    win_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]
    for p in win_paths:
        if p and os.path.exists(p):
            return p
    try:
        out = subprocess.check_output("where chrome", shell=True,
                                      stderr=subprocess.DEVNULL).decode(errors="ignore")
        for line in out.splitlines():
            cand = line.strip()
            if cand and os.path.exists(cand):
                return cand
    except Exception:
        pass
    return None

def get_chrome_full_version() -> Optional[str]:
    chrome_path = get_windows_chrome_path() if sys.platform == "win32" else None
    if chrome_path:
        try:
            out = subprocess.check_output([chrome_path, "--version"],
                                          stderr=subprocess.DEVNULL).decode(errors="ignore")
            m = re.search(r"[\d]+\.[\d]+\.[\d]+\.[\d]+", out)
            if m:
                return m.group(0)
        except Exception:
            pass
    for cmd in ["google-chrome", "chromium-browser", "chromium", "google-chrome-stable"]:
        try:
            out = subprocess.check_output([cmd, "--version"],
                                          stderr=subprocess.DEVNULL).decode(errors="ignore")
            m = re.search(r"[\d]+\.[\d]+\.[\d]+\.[\d]+", out)
            if m:
                return m.group(0)
        except Exception:
            pass
    return None

def get_matching_chromedriver_url(full_version: str) -> Optional[str]:
    major = full_version.split(".")[0]
    try:
        api = "https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json"
        with urllib.request.urlopen(api, timeout=15) as resp:
            data = json.loads(resp.read())
        candidates = [v for v in data["versions"] if v["version"].startswith(major + ".")]
        if not candidates:
            return None
        exact = [v for v in candidates if v["version"] == full_version]
        chosen = exact[0] if exact else candidates[-1]
        for item in chosen.get("downloads", {}).get("chromedriver", []):
            if sys.platform == "win32" and item["platform"] == "win64":
                return item["url"]
            if sys.platform != "win32" and item["platform"] == "linux64":
                return item["url"]
    except Exception:
        return None
    return None

def ensure_chromedriver() -> Optional[str]:
    driver_name = "chromedriver.exe" if sys.platform == "win32" else "chromedriver"
    local_driver = SCRIPT_DIR / driver_name
    if local_driver.exists():
        return str(local_driver)
    full_version = get_chrome_full_version()
    if full_version:
        url = get_matching_chromedriver_url(full_version)
        if url:
            zip_path = SCRIPT_DIR / "chromedriver_download.zip"
            try:
                print(f"[SETUP] Downloading ChromeDriver for Chrome {full_version}...", file=sys.stderr)
                urllib.request.urlretrieve(url, zip_path)
                with zipfile.ZipFile(zip_path, "r") as zf:
                    for name in zf.namelist():
                        base = os.path.basename(name)
                        if base.lower() == driver_name.lower():
                            extracted = SCRIPT_DIR / base
                            with zf.open(name) as src, open(extracted, "wb") as dst:
                                dst.write(src.read())
                            if sys.platform != "win32":
                                extracted.chmod(0o755)
                            zip_path.unlink(missing_ok=True)
                            return str(extracted)
            except Exception as exc:
                print(f"[WARN] ChromeDriver direct download failed: {exc}", file=sys.stderr)
            finally:
                zip_path.unlink(missing_ok=True)
    try:
        print("[SETUP] Trying webdriver-manager fallback for ChromeDriver...", file=sys.stderr)
        return ChromeDriverManager().install()
    except Exception as exc:
        print(f"[WARN] webdriver-manager fallback failed: {exc}", file=sys.stderr)
    return None

def make_driver():
    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1920,1080")
    opts.add_argument("--disable-extensions")
    opts.add_argument("--disable-background-networking")
    opts.add_argument("--disable-default-apps")
    opts.add_argument("--disable-sync")
    opts.add_argument("--disable-translate")
    opts.add_argument("--metrics-recording-only")
    opts.add_argument("--memory-pressure-off")
    opts.add_argument("--disable-features=TranslateUI")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    opts.set_capability("goog:loggingPrefs", {"performance": "ALL"})
    if sys.platform == "win32":
        chrome_path = get_windows_chrome_path()
        if chrome_path:
            opts.binary_location = chrome_path
        driver_path = ensure_chromedriver()
        if driver_path:
            return webdriver.Chrome(service=Service(driver_path), options=opts)
        raise RuntimeError(
            "ChromeDriver could not be prepared automatically on this Windows system.")
    for cb in ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]:
        if os.path.exists(cb):
            opts.binary_location = cb
            break
    return webdriver.Chrome(options=opts)

# ── login + token capture (copied verbatim from remittance scraper) ────────────

def login_and_get_token(driver) -> str:
    print("[LOGIN] Navigating to AMH login page...", file=sys.stderr)
    driver.get(LOGIN_URL)
    time.sleep(5)

    current_url = driver.current_url
    if "/login" not in current_url and "b2clogin" not in current_url:
        print("[LOGIN] Existing AMH session detected.", file=sys.stderr)
    else:
        print("[LOGIN] Switching to login iframe...", file=sys.stderr)
        iframe = WebDriverWait(driver, 20).until(
            EC.presence_of_element_located((By.ID, "loginIframe")))
        driver.switch_to.frame(iframe)
        time.sleep(2)

        print("[LOGIN] Entering credentials...", file=sys.stderr)
        email_input = WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.ID, "signInName")))
        email_input.clear()
        email_input.send_keys(EMAIL)
        time.sleep(0.4)

        pwd_input = driver.find_element(By.ID, "password")
        pwd_input.clear()
        pwd_input.send_keys(PASSWORD)
        time.sleep(0.4)

        print("[LOGIN] Submitting...", file=sys.stderr)
        try:
            submit = driver.find_element(By.ID, "next")
        except NoSuchElementException:
            submit = driver.find_element(By.XPATH,
                "//button[@type='submit'] | //input[@type='submit']")
        submit.click()
        driver.switch_to.default_content()

        print("[LOGIN] Waiting for redirect...", file=sys.stderr)
        redirected = False
        for _ in range(25):
            time.sleep(1)
            current = driver.current_url.lower()
            if "login" not in current and "b2clogin" not in current:
                redirected = True
                break
        if not redirected:
            print(f"[LOGIN] Redirect was slow; current URL: {driver.current_url}", file=sys.stderr)

    print("[LOGIN] Loading WO list to trigger authenticated API requests...", file=sys.stderr)
    driver.get(WO_LIST_URL)
    time.sleep(12)

    token = None
    for entry in driver.get_log("performance"):
        try:
            msg = json.loads(entry["message"])["message"]
            if msg.get("method") == "Network.requestWillBeSent":
                headers = msg["params"]["request"].get("headers", {})
                auth = headers.get("Authorization", "") or headers.get("authorization", "")
                if auth.startswith("Bearer "):
                    token = auth
                    break
        except Exception:
            pass

    if not token:
        raise RuntimeError("Could not capture Bearer token from network logs.")

    print(f"[LOGIN] Bearer token captured ({len(token)} chars).", file=sys.stderr)
    return token

# ── API (copied verbatim from remittance scraper) ─────────────────────────────

def api_get(path: str, token: str, params: Optional[Dict[str, str]] = None):
    url = f"{API_BASE}/{path}"
    if params:
        qs = "&".join(f"{k}={urllib.request.quote(str(v))}" for k, v in params.items())
        url = f"{url}?{qs}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": token,
            "Accept": "application/json",
            "Origin": "https://www.amh.com",
            "Referer": "https://www.amh.com/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())

def today_api_value() -> str:
    import datetime
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT04:00:00.000Z")

# ── item extraction (copied verbatim from remittance scraper) ──────────────────

def normalize_text(value: object) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()

def choose_options_for_bid(bid: Optional[dict]) -> List[dict]:
    if not bid:
        return []
    options = bid.get("options", []) or []
    approved = [opt for opt in options if opt.get("isApproved")]
    if approved:
        return approved
    preferred = [opt for opt in options if opt.get("isPreferred")]
    return preferred if preferred else options

def service_display_name(service: dict, order: Optional[dict] = None) -> str:
    desc = normalize_text(service.get("description"))
    if desc:
        return desc
    remedy = service.get("remedyInstance", {}) or {}
    remedy_id = normalize_text(service.get("remedyInstanceId"))
    if order and remedy_id:
        mapped = (order.get("remedyInstances", {}) or {}).get(remedy_id, {}) or {}
        if normalize_text(mapped.get("description")):
            return normalize_text(mapped.get("description"))
    return normalize_text(remedy.get("description")) or normalize_text(service.get("serviceId"))

# ── main ──────────────────────────────────────────────────────────────────────

def main():
    raw = sys.stdin.read().strip()
    wo_numbers: List[str] = json.loads(raw) if raw else []
    if not wo_numbers:
        print("{}", flush=True)
        return

    print(f"[API] Scraping {len(wo_numbers)} WO(s)...", file=sys.stderr)
    driver = make_driver()
    try:
        token = login_and_get_token(driver)
    finally:
        try:
            driver.quit()
        except Exception:
            pass

    print("[API] Fetching Order/Query...", file=sys.stderr)
    orders = api_get("Order/Query", token, {"today": today_api_value(), "loadFiles": "false"})
    if not isinstance(orders, list):
        orders = orders.get("orders") or orders.get("items") or []
    print(f"[API] Got {len(orders)} order(s).", file=sys.stderr)

    # Build lookup: WO number (no WO- prefix) → order item
    order_map: Dict[str, dict] = {}
    for item in orders:
        o = item.get("order") or item
        name = re.sub(r"^WO-", "", normalize_text(o.get("name")), flags=re.I).strip()
        if name:
            order_map[name] = item

    results = {}
    for wo_num in wo_numbers:
        stripped = re.sub(r"^WO-", "", wo_num, flags=re.I).strip()
        item = order_map.get(stripped)
        if not item:
            results[wo_num] = {"ok": False, "error": f"WO {stripped} not found in API response"}
            continue

        order = item.get("order") or item
        bids = order.get("bids") or []

        # Pick best bid: approved first, then first available
        approved_bids = [b for b in bids
                         if normalize_text(b.get("statusName")).lower() == "approved"]
        bid = approved_bids[0] if approved_bids else (bids[0] if bids else None)

        options = choose_options_for_bid(bid)
        all_items: List[Dict] = []
        total = 0.0

        for option in options:
            for service in (option.get("services") or []):
                name = service_display_name(service, order)
                qty        = float(service.get("quantity")  or 0) or 1.0
                unit_price = float(service.get("unitPrice") or 0)
                vendor_tax = float(service.get("vendorTax") or 0)
                line_total = round(qty * unit_price + vendor_tax, 2)
                if not name or unit_price <= 0:
                    continue
                if any(x["name"].lower() == name.lower() for x in all_items):
                    continue
                all_items.append({"name": name, "qty": qty, "price": unit_price})
                total += line_total

        total = round(total, 2)
        if not all_items:
            bid_statuses = list({normalize_text(b.get("statusName")) for b in bids})
            results[wo_num] = {"ok": True, "items": [], "scrapedTotal": 0.0,
                               "warning": f"No items extracted (bid statuses: {bid_statuses})"}
        else:
            results[wo_num] = {"ok": True, "items": all_items, "scrapedTotal": total}
            print(f"  {wo_num}: {len(all_items)} item(s), ${total}", file=sys.stderr)

    print(json.dumps(results), flush=True)

if __name__ == "__main__":
    main()
