"""
Regression test: SOP card click should navigate to text without errors.
Specifically tests issue ID 4 (WHY paragraph urgency).
Root cause: (start[0] as HTMLElement)?.closest('.ProseMirror') on a TextNode.
"""

from playwright.sync_api import sync_playwright
import sys

TEST_ARTICLE = """# Judul Artikel

Ini adalah paragraf lead yang menjelaskan inti permasalahan hukum tentang sengketa tanah.

Paragraf ini adalah paragraf WHY yang membahas latar belakang masalah. Pembahasan tentang latar belakang ini perlu dipahami oleh pembaca agar mengerti konteks permasalahan yang sedang dihadapi.

Pada bagian ini kami akan membahas langkah-langkah penyelesaian sengketa tanah melalui jalur non-litigasi yang dapat ditempuh oleh para pihak yang bersengketa."""

def test_sop_card_click():
    errors = []
    sop_click_captured = False

    def handle_console(msg):
        nonlocal sop_click_captured
        text = msg.text
        if msg.type == 'error':
            errors.append(text)
        if 'handleSopCardClick' in text or 'SOP CLICK' in text:
            sop_click_captured = True

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})
        page.on("console", handle_console)
        page.on("pageerror", lambda err: errors.append(str(err)))

        page.goto('http://localhost:5173')
        page.wait_for_load_state('domcontentloaded')
        page.wait_for_timeout(2000)

        # Type article into ProseMirror editor
        editor = page.locator('.ProseMirror')
        editor.wait_for(state='visible', timeout=5000)
        editor.click()
        page.wait_for_timeout(300)
        page.keyboard.press('Control+a')
        page.wait_for_timeout(100)
        page.keyboard.press('Delete')
        page.wait_for_timeout(100)
        page.keyboard.insert_text(TEST_ARTICLE)
        page.wait_for_timeout(500)

        # Click "Periksa" button
        periksa_btn = page.get_by_role('button', name='Periksa')
        periksa_btn.wait_for(state='visible', timeout=5000)
        periksa_btn.click()

        # Wait for check to complete (button returns to "Periksa" state)
        page.wait_for_timeout(3000)
        try:
            page.wait_for_function(
                "() => document.querySelector('button:has(svg.lucide-target)') !== null",
                timeout=15000
            )
        except:
            pass
        page.wait_for_timeout(1000)

        # Find and click the Lead/WHY card
        lead_btn = page.locator('button:has-text("Lead")').first
        if lead_btn.count() > 0:
            lead_btn.click()
            page.wait_for_timeout(1500)
        else:
            errors.append("Lead button not found")

        browser.close()

    # Assertions
    if errors:
        print(f"FAILED: {len(errors)} error(s) found:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("PASSED: No page errors during SOP card click")


if __name__ == '__main__':
    test_sop_card_click()
