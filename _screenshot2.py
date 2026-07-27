from playwright.sync_api import sync_playwright
import os, json

OUT = "C:\\Users\\mp2pf\\OneDrive\\Documents\\Legal\\Article Checker\\graphify-out"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:5173")
    page.wait_for_load_state("load")
    page.wait_for_timeout(3000)

    # Screenshot the full right panel (eval panel)
    eval_panel = page.locator("#eval-panel")
    if eval_panel.is_visible():
        eval_panel.screenshot(path=os.path.join(OUT, "ui_eval_panel.png"))
        print("eval panel captured")

    # Screenshot the score panel section
    score_panel = page.locator("#score-panel")
    if score_panel.is_visible():
        score_panel.screenshot(path=os.path.join(OUT, "ui_score_panel.png"))
        print("score panel captured")

    # Screenshot the setup panel (keyword/title/desc)
    setup_panel = page.locator("#setup-panel")
    if setup_panel.is_visible():
        setup_panel.screenshot(path=os.path.join(OUT, "ui_setup_panel.png"))
        print("setup panel captured")

    # Get detailed computed styles of key elements
    styles = page.evaluate("""
        () => {
            const els = {
                scoreRing: document.querySelector('#score-panel .score-ring, #score-panel svg, #score-panel [class*=ring]'),
                scoreNumber: document.querySelector('#score-panel [class*=text-2xl], #score-panel .score-value, #score-panel [class*=font-black]'),
                subScoreCards: document.querySelectorAll('#score-panel .grid > div, #score-panel [class*=col-span]'),
                evalCards: document.querySelectorAll('#eval-panel [class*=rounded-]'),
                evalCheckmarks: document.querySelectorAll('#eval-panel svg, #eval-panel [class*=check], #eval-panel [class*=Check]'),
                evalTabButtons: document.querySelectorAll('#eval-panel button, #eval-panel [role=tab]'),
            };
            const result = {};
            for (const [key, nodes] of Object.entries(els)) {
                if (!nodes || nodes.length === 0) { result[key] = null; continue; }
                const arr = [];
                for (const n of (nodes.forEach ? (nodes.forEach((_,i)=>arr.push(nodes[i])), arr) : [nodes])) {
                    const rect = n.getBoundingClientRect();
                    const style = window.getComputedStyle(n);
                    arr.push({
                        tag: n.tagName,
                        id: n.id || null,
                        class: n.className.slice(0, 100),
                        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                        bg: style.backgroundColor,
                        color: style.color,
                        borderRadius: style.borderRadius,
                        boxShadow: style.boxShadow.slice(0, 80),
                        fontSize: style.fontSize,
                        fontWeight: style.fontWeight,
                        fontFamily: style.fontFamily.split(',')[0].replace(/['"]/g,''),
                    });
                }
                result[key] = arr;
            }
            return result;
        }
    """)
    with open(os.path.join(OUT, "ui_computed_styles.json"), "w") as f:
        json.dump(styles, f, indent=2)

    # Count evaluation items and their icons
    eval_items = page.evaluate("""
        () => {
            const items = document.querySelectorAll('#eval-panel [class*=rounded-][class*=border]');
            return items.length;
        }
    """)
    print(f"Eval items found: {eval_items}")

    # Check if "Periksa" button exists
    check_btn = page.locator("button:has-text('Periksa')")
    print(f"Periksa button visible: {check_btn.is_visible()}")

    browser.close()
