from playwright.sync_api import sync_playwright
import os

OUT = "C:\\Users\\mp2pf\\OneDrive\\Documents\\Legal\\Article Checker\\graphify-out"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    page.goto("http://localhost:5173")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)

    # Full page screenshot
    page.screenshot(path=os.path.join(OUT, "ui_fullpage.png"), full_page=True)

    # Viewport screenshot (above the fold)
    page.screenshot(path=os.path.join(OUT, "ui_viewport.png"))

    # Key sections - find them by common patterns
    sections = [
        ("sidebar", "nav, aside, [class*=sidebar], [class*=Sidebar]"),
        ("editor", "[class*=editor], [class*=Editor], .ProseMirror, [contenteditable]"),
        ("toolbar", "[class*=toolbar], [class*=Toolbar], header, nav"),
    ]
    for name, sel in sections:
        try:
            el = page.locator(sel).first
            if el.is_visible():
                el.screenshot(path=os.path.join(OUT, f"ui_{name}.png"))
        except:
            pass

    # Get page title and visible text summary
    title = page.title()
    print(f"Page title: {title}")

    # List interactive elements
    buttons = page.locator("button, [role=button], a[href]")
    print(f"Interactive elements: {buttons.count()}")

    # Check if dark mode or light mode
    body_bg = page.evaluate("""
        () => getComputedStyle(document.body).backgroundColor
    """)
    print(f"Body background: {body_bg}")

    # Get all major sections
    sections_info = page.evaluate("""
        () => Array.from(document.querySelectorAll('section, main, header, footer, aside, [class*=panel], [class*=Panel]'))
            .map(el => ({
                tag: el.tagName,
                id: el.id || null,
                classes: el.className.slice(0, 120),
                rect: el.getBoundingClientRect()
            }))
    """)
    print(f"Major sections: {len(sections_info)}")
    for s in sections_info[:10]:
        print(f"  <{s['tag']}> id={s['id']} class={s['classes'][:80]}")

    browser.close()
