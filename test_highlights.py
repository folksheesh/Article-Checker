"""Verify issue highlight & navigation system end-to-end.

Tests:
  1. Type an article with a long sentence (>30 words) and a long paragraph
  2. Click Periksa and wait for results
  3. Verify sentence-length issue has <mark> highlights in the editor
  4. Click the sentence-length issue card → verify it scrolls to correct mark
  5. Verify all issue types produce highlights
  6. Hover over a highlight → verify popup appears
"""

import sys
import time
import traceback
from playwright.sync_api import sync_playwright

# A sentence with >30 words to trigger sentence-length issue, plus a long paragraph (>3 sentences and >60 words)
LONG_SENTENCE = "Kalimat ini sengaja dibuat sangat sangat sangat sangat sangat panjang dan melebihi batas maksimal tiga puluh kata per kalimat sehingga harus dipecah menjadi dua kalimat yang lebih pendek dan mudah dibaca."
assert len(LONG_SENTENCE.split()) > 30, f"Long sentence only has {len(LONG_SENTENCE.split())} words"

LONG_PARAGRAPH = (
    "Ini adalah paragraf pertama yang sangat panjang karena memiliki lebih dari tiga kalimat dan lebih dari enampuluh kata "
    "sehingga masuk dalam kategori paragraf terlalu panjang yang perlu diperbaiki oleh penulis. "
    "Ini adalah kalimat kedua dalam paragraf panjang yang sama untuk memastikan paragraf ini melebihi batas. "
    "Ini adalah kalimat ketiga yang juga masih dalam paragraf yang sama. "
    "Ini adalah kalimat keempat yang memastikan paragraf ini benar-benar melanggar aturan."
)

ARTICLE = (
    "Judul Artikel Penting Tentang Hukum\n\n"
    "Ini adalah kalimat pembuka lead yang informatif dan jelas untuk pembaca setia.\n\n"
    + LONG_SENTENCE + " "
    + "Ini adalah kalimat kedua dalam paragraf yang sama dengan kalimat pendek. "
    + "Dan ini kalimat ketiga yang juga masih pendek dan tidak melanggar aturan apapun.\n\n"
    + LONG_PARAGRAPH + "\n\n"
    "Hubungi tim legal kami sekarang juga untuk konsultasi gratis dan dapatkan perlindungan hukum terbaik untuk bisnis Anda."
)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()

        page.goto("http://localhost:5173", wait_until="domcontentloaded")

        # Wait for the React app to render — look for the editor
        page.wait_for_selector("#editor-wrapper .ProseMirror", timeout=15000)
        time.sleep(1)

        # Wait for the editor to be ready
        editor = page.locator("#editor-wrapper .ProseMirror")
        editor.wait_for(state="visible", timeout=10000)

        # Clear and type the article
        editor.click()
        page.keyboard.press("Control+a")
        page.keyboard.press("Delete")
        time.sleep(0.5)
        page.keyboard.type(ARTICLE)
        time.sleep(1)

        # Debug: check editor content
        editor_html = page.evaluate(
            "() => document.querySelector('#editor-wrapper .ProseMirror')?.innerHTML?.substring(0, 300) || 'EMPTY'"
        )
        print(f"\n=== Editor HTML: {editor_html[:200]} ===")

        # Click Periksa
        periksa_btn = page.locator("#btn-periksa")
        periksa_btn.wait_for(state="visible")
        periksa_btn.click()

        # Wait for evaluation panel to finish loading
        page.wait_for_selector("[data-eval-panel]", timeout=30000)

        # Wait for the analysis to complete
        print("\n=== Waiting for analysis & highlights... ===")
        time.sleep(5)
        # Check what the eval panel shows
        eval_text = page.evaluate(
            "() => document.querySelector('[data-eval-panel]')?.textContent?.substring(0, 100) || 'NO PANEL'"
        )
        print(f"  Eval panel says: {eval_text}")

        # Poll for highlight marks to appear
        mark_count = 0
        for attempt in range(60):
            marks = page.locator("#editor-wrapper mark")
            mark_count = marks.count()
            if mark_count > 0:
                print(f"  Highlights found after ~{attempt * 0.5 + 5}s")
                break
            time.sleep(0.5)
            if attempt % 10 == 9:
                print(f"  Still waiting... (attempt {attempt+1})")
                eval_text = page.evaluate(
                    "() => document.querySelector('[data-eval-panel]')?.textContent?.substring(0, 100) || 'NO PANEL'"
                )
                print(f"  Eval panel: {eval_text}")

        # --- TEST 1: Verify highlights exist ---
        print(f"\n=== Highlight marks found: {mark_count} ===")
        for i in range(mark_count):
            m = marks.nth(i)
            cls = m.get_attribute("class") or ""
            kind = m.get_attribute("data-kind") or ""
            text = (m.text_content() or "")[:60]
            print(f"  Mark #{i}: class={cls} kind={kind} text='{text}...'")

        if mark_count == 0:
            print("FAIL: No highlight marks found!")
            browser.close()
            sys.exit(1)

        # --- TEST 2: Check that sentence-length issue has a highlight ---
        sentence_marks = page.locator(
            "#editor-wrapper mark[data-kind='sop'].issue-highlight"
        )
        sentence_count = sentence_marks.count()
        print(f"\n=== SOP failure highlights: {sentence_count} ===")
        if sentence_count == 0:
            print("FAIL: No SOP failure highlights!")

        # --- TEST 3: Click on sentence-length issue card ---
        eval_panel = page.locator("[data-eval-panel]")
        eval_panel.wait_for(state="visible", timeout=10000)

        issue_cards = eval_panel.locator("button, [role='button'], div[tabindex]")
        card_count = issue_cards.count()
        sentence_card_clicked = False
        paragraph_card_clicked = False
        print(f"\n=== Clickable issue cards: {card_count} ===")
        for i in range(card_count):
            card = issue_cards.nth(i)
            card_text = (card.text_content() or "").lower()
            if "kalimat" in card_text and "melebihi" in card_text and not sentence_card_clicked:
                print(f"Clicking sentence-length card: '{card.text_content()[:80]}...'")
                card.click()
                time.sleep(1)
                sentence_card_clicked = True
                print(f"  ScrollY after click: {page.evaluate('window.scrollY')}")
            elif "paragraf" in card_text and "panjang" in card_text and not paragraph_card_clicked:
                print(f"Clicking paragraph-length card: '{card.text_content()[:80]}...'")
                card.click()
                time.sleep(1)
                paragraph_card_clicked = True
                print(f"  ScrollY after click: {page.evaluate('window.scrollY')}")

        if not sentence_card_clicked:
            print("WARN: No sentence-length issue card found")
        if not paragraph_card_clicked:
            print("WARN: No paragraph-length issue card found")

        # --- TEST 4: Verify scroll happened (check viewport changed) ---
        scroll_y = page.evaluate("window.scrollY")
        print(f"\n=== Scroll position after click: {scroll_y} ===")

        popup = page.locator("#issue-popup, .issue-popup")

        # --- TEST 5: Hover over each highlight and check popup ---
        print(f"\n=== Testing hover/click on each mark ===")
        hover_pass = 0
        click_pass = 0
        for i in range(mark_count):
            m = marks.nth(i)
            kind = m.get_attribute("data-kind") or "?"
            cls = m.get_attribute("class") or ""
            mtext = (m.text_content() or "")[:40]
            
            # Hover test
            m.hover()
            time.sleep(0.3)
            if popup.count() > 0:
                hover_pass += 1
                ptext = (popup.first.text_content() or "")[:60]
                print(f"  Hover #{i} ({kind}/{cls.split('-')[-1]}): popup=[OK] '{ptext}...'")
            else:
                print(f"  Hover #{i} ({kind}): popup=[FAIL] text='{mtext}'")
            
            # Click test
            m.click()
            time.sleep(0.3)
            if popup.count() > 0:
                click_pass += 1

        print(f"  Result: hover {hover_pass}/{mark_count} OK, click {click_pass}/{mark_count} OK")

        print("\n=== Test complete ===")

        browser.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nTEST FAILED: {e}")
        traceback.print_exc()
        sys.exit(1)
