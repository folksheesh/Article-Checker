"""
Debug: Verify paragraph-length issue card highlights text when clicked.
The Paragraf card label is "Paragraf" in a div.text-xs.
"""

from playwright.sync_api import sync_playwright
import time

TEST_ARTICLE = """# Judul Artikel

Ini adalah paragraf lead yang menjelaskan inti permasalahan hukum tentang sengketa tanah.

Paragraf ini adalah paragraf WHY yang membahas latar belakang masalah secara sangat rinci dan detail karena pembahasan tentang latar belakang ini perlu dipahami oleh pembaca agar mengerti konteks permasalahan yang sedang dihadapi oleh para pihak yang bersengketa sehingga mereka dapat memahami secara menyeluruh setiap aspek dari permasalahan ini dan bagaimana hal tersebut berdampak pada kehidupan mereka sehari-hari termasuk aspek ekonomi sosial dan hukum yang kompleks. Karena itu diperlukan pemahaman yang mendalam.

Pada bagian ini kami akan membahas langkah-langkah penyelesaian sengketa tanah melalui jalur non-litigasi yang dapat ditempuh oleh para pihak yang bersengketa."""

console_logs = []

def handle_console(msg):
    text = msg.text
    console_logs.append(f"[{msg.type}] {text}")
    if any(k in text for k in ['[APPLY]', '[SOP CLICK]', '[SOP SEL]']):
        print(f"  >> {text[:200]}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1920, 'height': 1080})
    page.on("console", handle_console)
    page.on("pageerror", lambda err: console_logs.append(f"[PAGE_ERROR] {err}"))

    page.goto('http://localhost:5173')
    page.wait_for_load_state('domcontentloaded')
    page.wait_for_timeout(2000)

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

    kw_input = page.locator('#input-keyword')
    kw_input.wait_for(state='visible', timeout=5000)
    kw_input.click()
    page.wait_for_timeout(100)
    page.keyboard.press('Control+a')
    page.keyboard.press('Delete')
    page.keyboard.insert_text('sengketa')
    page.wait_for_timeout(300)

    periksa_btn = page.get_by_role('button', name='Periksa')
    periksa_btn.wait_for(state='visible', timeout=5000)
    periksa_btn.click()

    page.wait_for_timeout(3000)
    try:
        page.wait_for_function(
            "() => document.querySelector('button:has(svg.lucide-target)') !== null",
            timeout=20000
        )
    except:
        pass
    page.wait_for_timeout(2000)

    # List ALL SOP card buttons and their label text
    all_sop_cards = page.evaluate("""() => {
        const buttons = document.querySelectorAll('button');
        const results = [];
        for (const btn of buttons) {
            const label = btn.querySelector('.text-xs.font-medium');
            if (label) {
                results.push({
                    label: label.textContent.trim(),
                    fullText: btn.textContent.replace(/\\n/g, ' ').trim().slice(0, 100),
                    id: btn.getAttribute('data-sop-id') || 'none'
                });
            }
        }
        return results;
    }""")
    print(f"[INFO] SOP cards found: {len(all_sop_cards)}")
    for i, card in enumerate(all_sop_cards):
        print(f"  [{i}] label='{card['label']}' text='{card['fullText']}'")

    # Find the Paragraf card by EXACT label match (not substring)
    para_card = page.locator('div.text-xs.font-medium:text-is("Paragraf")').first
    if para_card.count() == 0:
        print("[FAIL] No Paragraf label found")
        browser.close()
        exit(1)

    # Click the parent button of the label
    para_btn = para_card.locator('xpath=ancestor::button').first
    print(f"\n[INFO] Clicking Paragraf card...")
    para_btn.click()
    page.wait_for_timeout(2000)

    result = page.evaluate("""() => {
        const activeMarks = document.querySelectorAll('mark.issue-highlight-active');
        const allMarks = document.querySelectorAll('mark[data-issue-ids], mark[data-issue-id]');
        const sel = window.getSelection();
        const selText = sel && sel.rangeCount ? sel.toString().slice(0, 120) : '';
        const activeTexts = Array.from(activeMarks).map(m => m.textContent.slice(0, 80));
        return {
            active_count: activeMarks.length,
            total_marks: allMarks.length,
            selection: selText,
            selLen: selText.length,
            active_texts: activeTexts
        };
    }""")

    print(f"\n[RESULT] After clicking Paragraf card:")
    print(f"  Active marks: {result['active_count']}")
    print(f"  Total marks: {result['total_marks']}")
    print(f"  Selection: '{result['selection']}' (len={result['selLen']})")
    print(f"  Active mark texts: {result['active_texts']}")

    if result['active_count'] > 0 and result['selLen'] > 0:
        print("\n[PASS] Paragraf card highlights text and selects it correctly!")
    elif result['active_count'] > 0:
        print("\n[PASS] Mark highlighted but no text selection (popup shown)")
    else:
        print("\n[FAIL] No marks highlighted after clicking Paragraf card")

    browser.close()
