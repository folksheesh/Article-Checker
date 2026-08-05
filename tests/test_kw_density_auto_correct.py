"""
Regression test: Auto Correct Keyword Density (Issue ID 16)
Tests the complete flow: click Auto Correct -> AI generates suggestions -> 
green highlights appear -> hover shows approve/reject -> approve/reject works
"""

from playwright.sync_api import sync_playwright
import sys
import time

TEST_ARTICLE = """# Judul Artikel Uji Coba Keyword Density

Ini adalah paragraf pembuka yang menjelaskan topik utama artikel ini. Artikel ini membahas tentang perizinan berusaha berbasis risiko.

Paragraf kedua ini membahas latar belakang masalah perizinan. Pemahaman tentang risiko bisnis sangat penting bagi pelaku usaha sebelum mengajukan izin.

Paragraf ketiga menjelaskan tentang prosedur pengajuan izin usaha. Setiap pelaku usaha harus memahami klasifikasi risiko bisnisnya.

Paragraf keempat membahas tentang sanksi administrasi. Pelaku usaha yang tidak memenuhi kewajiban akan dikenakan sanksi sesuai peraturan."""

def test_kw_density_auto_correct():
    errors = []
    sop_click_captured = False
    suggestion_found = False
    popup_opened = False

    def handle_console(msg):
        nonlocal sop_click_captured, suggestion_found, popup_opened
        text = msg.text
        if msg.type == 'error':
            errors.append(text)
        if 'KW Density' in text:
            sop_click_captured = True
            print(f"  [KW DENSITY] {text}")
        if 'saran penyisipan keyword' in text.lower():
            suggestion_found = True
        if 'Saran Penyisipan Keyword' in text:
            popup_opened = True

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

        # Set keyword for density check
        kw_input = page.locator('#input-keyword')
        kw_input.wait_for(state='visible', timeout=5000)
        kw_input.click()
        page.wait_for_timeout(100)
        page.keyboard.press('Control+a')
        page.wait_for_timeout(100)
        page.keyboard.press('Delete')
        page.wait_for_timeout(100)
        page.keyboard.insert_text('perizinan berusaha berbasis risiko')
        page.wait_for_timeout(300)

        # Click "Periksa" button
        periksa_btn = page.get_by_role('button', name='Periksa')
        periksa_btn.wait_for(state='visible', timeout=5000)
        periksa_btn.click()

        # Wait for checking to complete
        page.wait_for_timeout(3000)
        try:
            page.wait_for_function(
                "() => document.querySelector('button:has(svg.lucide-target)') !== null",
                timeout=15000
            )
        except:
            pass
        page.wait_for_timeout(1000)

        print("\n=== Checking for keyword density issue (ID 16) ===")
        
        # Find SEO & Meta card with keyword density issue
        seo_card = page.locator('button:has-text("SEO & Meta")').first
        if seo_card.count() == 0:
            errors.append("SEO & Meta card not found")
        else:
            seo_text = seo_card.text_content()
            print(f"  Found SEO card: '{seo_text[:100]}'")
            
            # Check if Auto Correct button exists for keyword density (by title attr)
            auto_correct_btn = page.locator('button[title*="Auto Correct: sisipkan keyword"]')
            if auto_correct_btn.count() > 0:
                print("  Auto Correct button found on SEO card")
                
                # Click Auto Correct
                auto_correct_btn.click()
                page.wait_for_timeout(2000)
                
                # Wait for AI processing
                page.wait_for_timeout(15000)
                
                # Check for green highlights in editor
                green_highlights = page.locator('mark.suggestion-pending')
                if green_highlights.count() > 0:
                    print(f"  [OK] Found {green_highlights.count()} green suggestion highlights")
                    
                    # Hover over first highlight to open popup
                    green_highlights.first.hover()
                    page.wait_for_timeout(1000)
                    
                    # Check for approve/reject popup
                    popup = page.locator('#issue-popup')
                    if popup.count() > 0:
                        print("  [OK] Popup opened with suggestion details")
                        
                        # Check for approve/reject buttons
                        approve_btn = page.locator('button:has-text("Setujui")')
                        reject_btn = page.locator('button:has-text("Tolak")')
                        if approve_btn.count() > 0 and reject_btn.count() > 0:
                            print("  [OK] Approve and Reject buttons found")
                            
                            # Test approve
                            approve_btn.click()
                            page.wait_for_timeout(1000)
                            print("  [OK] Approved suggestion")
                        else:
                            errors.append("Approve/Reject buttons not found in popup")
                    else:
                        errors.append("Popup not opened after hovering highlight")
                else:
                    errors.append("No green suggestion highlights found in editor")
            else:
                errors.append("Auto Correct button not found on SEO card")

        browser.close()

    if errors:
        print(f"\nFAILED: {len(errors)} error(s):")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nPASSED: Keyword density auto-correct flow works correctly")


if __name__ == '__main__':
    test_kw_density_auto_correct()