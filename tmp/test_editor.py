from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto("http://localhost:8123/editor/index.html")
    page.wait_for_timeout(800)
    print("quiz name value:", repr(page.input_value("#quizName"))[:60])
    print("questions tabs count:", len(page.query_selector_all("#questionTabs button")))
    print("preview nav present:", bool(page.query_selector("#pvNavBar")), "| pv tabs:", len(page.query_selector_all("#pvQuestionTabs button")))
    # check flags near open-test button exist
    for fl in ["flCheckMode","flShowHeader","flCrushMode","flRandomMode"]:
        print(fl, "exists:", bool(page.query_selector("#"+fl)))
    # buildTaskUrl uses mt_v2?
    url = page.evaluate("buildTaskUrl ? buildTaskUrl() : ''") if True else ""
    print("buildTaskUrl():", url[:120])
    # navigate preview with Alt+Right
    page.keyboard.press("Alt+ArrowRight")
    page.wait_for_timeout(300)
    print("pv question number after Alt+Right:", page.inner_text("#pvQuestionNumber"))
    print("JS errors:", errors)
    b.close()
