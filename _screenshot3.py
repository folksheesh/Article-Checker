from playwright.sync_api import sync_playwright
import os, json

OUT = "C:\\Users\\mp2pf\\OneDrive\\Documents\\Legal\\Article Checker\\graphify-out"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto("http://localhost:5173")
    page.wait_for_load_state("load")
    page.wait_for_timeout(3000)

    # Get visual computed styles from score panel
    info = page.evaluate("""
        () => {
            const r = {};
            // Score panel structure
            const sp = document.querySelector('#score-panel');
            if (sp) {
                r.scorePanel = {
                    w: sp.offsetWidth,
                    h: sp.offsetHeight,
                    children: sp.children.length
                };
                // Get all text content
                r.scoreTexts = Array.from(sp.querySelectorAll('*')).filter(el => el.children.length === 0 && el.textContent.trim()).map(el => ({
                    text: el.textContent.trim().slice(0,40),
                    fontSize: getComputedStyle(el).fontSize,
                    fontWeight: getComputedStyle(el).fontWeight,
                    color: getComputedStyle(el).color,
                    fontFamily: getComputedStyle(el).fontFamily.split(',')[0].replace(/['"]/g,'')
                }));
            }

            // Eval panel structure
            const ep = document.querySelector('#eval-panel');
            if (ep) {
                r.evalPanel = { w: ep.offsetWidth, h: ep.offsetHeight };
                // Check icon SVGs
                r.checkIcons = Array.from(ep.querySelectorAll('svg')).slice(0,5).map(svg => ({
                    w: svg.getBoundingClientRect().width,
                    h: svg.getBoundingClientRect().height,
                    fill: svg.querySelector('path,circle')?.getAttribute('fill') || 'none',
                    viewBox: svg.getAttribute('viewBox') || ''
                }));
                // Cards
                r.evalCards = Array.from(ep.querySelectorAll('[class*=rounded]')).slice(0,8).map(c => ({
                    tag: c.tagName,
                    cls: c.className.slice(0,80),
                    rect: { w: c.offsetWidth, h: c.offsetHeight },
                    bg: getComputedStyle(c).backgroundColor,
                    border: getComputedStyle(c).border.slice(0,40),
                    borderRadius: getComputedStyle(c).borderRadius
                }));
            }

            // Overall card colors
            r.allCards = Array.from(document.querySelectorAll('[class*=rounded-2xl], [class*=rounded-xl]')).map(c => ({
                bg: getComputedStyle(c).backgroundColor,
                shadow: getComputedStyle(c).boxShadow.slice(0,60),
                borderRadius: getComputedStyle(c).borderRadius
            }));

            return r;
        }
    """)
    with open(os.path.join(OUT, "ui_styles.json"), "w", encoding="utf-8") as f:
        json.dump(info, f, indent=2, ensure_ascii=False)
    print(f"Score texts: {len(info.get('scoreTexts',[]))}")
    print(f"Check icons: {len(info.get('checkIcons',[]))}")
    print(f"Eval cards: {len(info.get('evalCards',[]))}")

    browser.close()
