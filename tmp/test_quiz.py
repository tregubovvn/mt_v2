import sys
from playwright.sync_api import sync_playwright

def run(p, checkmode=False, crushmode=False, randommode=False):
    browser = p.chromium.launch()
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    url = "http://localhost:8123/index.html"
    flags = []
    if checkmode: flags.append("CheckMode=true")
    if crushmode: flags.append("CrushMode=true")
    if randommode: flags.append("RandomMode=true")
    if flags: url += "?" + "&".join(flags)
    page.goto(url)
    # enter name via overlay (real user flow)
    page.fill("#lastNameInput", "Тестов")
    page.fill("#firstNameInput", "Иван")
    page.click("#confirmNameBtn")
    try:
        page.wait_for_function("!document.getElementById('welcomeOverlay').classList.contains('hidden')===false", timeout=5000) if False else None
        page.wait_for_function("document.getElementById('welcomeOverlay').classList.contains('hidden')", timeout=5000)
    except Exception:
        print("FAIL: overlay still open; errors:", errors); browser.close(); return False
    page.click("#demoBtn")
    try:
        page.wait_for_selector("#testSection:not(.hidden)", timeout=6000)
    except Exception:
        print("FAIL: test section did not appear; errors:", errors); browser.close(); return False
    cb_present = bool(page.query_selector(".check-block .btn"))
    expected_cb = checkmode and not crushmode
    if cb_present != expected_cb:
        print(f"FAIL: check button present={cb_present}, expected={expected_cb}"); browser.close(); return False
    for _ in range(8):
        opts = page.query_selector_all(".answer-option")
        if not opts: break
        opts[0].click()
        cb = page.query_selector(".check-block .btn")
        if cb and not cb.is_disabled():
            cb.click(); page.wait_for_timeout(150)
        nb = page.query_selector("#nextBtn")
        if nb is None or nb.is_disabled():
            break
        nb.click(); page.wait_for_timeout(900)
    fb = page.query_selector("#finishBtn")
    page.on("dialog", lambda d: d.accept())
    if fb and fb.is_visible():
        fb.click()
    try:
        page.wait_for_selector("#resultsSection:not(.hidden)", timeout=6000)
    except Exception:
        print("FAIL: results did not appear; errors:", errors); browser.close(); return False
    print("RESULTS OK:", page.inner_text("#score").strip(), "|", page.inner_text("#gradePill").strip())
    browser.close()
    print("JS errors:", errors)
    return len(errors) == 0

with sync_playwright() as p:
    ok = True
    for cm, cr, rm in [(False,False,False),(True,False,False),(False,True,False),
                       (True,True,False),(False,False,True),(True,False,True),(True,True,True)]:
        print(f"\n=== CheckMode={cm} CrushMode={cr} RandomMode={rm} ===")
        ok = run(p, cm, cr, rm) and ok
    print("\nALL PASS" if ok else "\nSOME FAILED")
    sys.exit(0 if ok else 1)
