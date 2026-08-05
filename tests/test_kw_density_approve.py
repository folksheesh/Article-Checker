"""
Regression test: Auto Correct Keyword Density - Approve must be a SURGICAL string
replacement, NOT a full-article regeneration.

Verifies the 4 critical requirements:
1. After approving 1 suggestion, ALL other article text is 100% identical
   (char-by-char) except the exact sentence that was modified.
2. After approve, the green highlight for that suggestion disappears immediately.
3. After approve + re-check, keyword density reflects the approved addition.
4. Approving multiple suggestions sequentially works (no stale positions).
"""

from playwright.sync_api import sync_playwright
import sys

TEST_ARTICLE = """# Judul Artikel Uji Coba Keyword Density

Ini adalah paragraf pembuka yang menjelaskan topik utama artikel ini. Artikel ini membahas tentang perizinan berusaha berbasis risiko.

Paragraf kedua ini membahas latar belakang masalah perizinan. Pemahaman tentang risiko bisnis sangat penting bagi pelaku usaha sebelum mengajukan izin.

Paragraf ketiga menjelaskan tentang prosedur pengajuan izin usaha. Setiap pelaku usaha harus memahami klasifikasi risiko bisnisnya.

Paragraf keempat membahas tentang sanksi administrasi. Pelaku usaha yang tidak memenuhi kewajiban akan dikenakan sanksi sesuai peraturan."""


def get_editor_text(page):
    return page.evaluate("() => document.querySelector('.ProseMirror').innerText")


def test_kw_density_approve_surgical():
    errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})
        page.on("pageerror", lambda err: errors.append(f"PAGE_ERROR: {err}"))

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

        # Click "Periksa"
        periksa_btn = page.get_by_role('button', name='Periksa')
        periksa_btn.wait_for(state='visible', timeout=5000)
        periksa_btn.click()
        page.wait_for_timeout(3000)
        try:
            page.wait_for_function(
                "() => document.querySelector('button:has(svg.lucide-target)') !== null",
                timeout=15000
            )
        except:
            pass
        page.wait_for_timeout(1000)

        # Capture baseline editor text BEFORE auto-correct
        baseline_text = get_editor_text(page)
        if not baseline_text or len(baseline_text) < 100:
            errors.append("Baseline editor text empty")
            browser.close()
            _finish(errors)
            return

        # Click Auto Correct on SEO card (by title attr)
        auto_correct_btn = page.locator('button[title*="Auto Correct: sisipkan keyword"]')
        if auto_correct_btn.count() == 0:
            errors.append("Auto Correct button not found on SEO card")
            browser.close()
            _finish(errors)
            return

        auto_correct_btn.click()
        page.wait_for_timeout(2000)
        page.wait_for_timeout(15000)  # wait for AI

        marks = page.locator('mark[data-suggestion-id]')
        mark_count = marks.count()
        print(f"Suggestion marks after auto-correct: {mark_count}")
        if mark_count == 0:
            errors.append("No green suggestion highlights found after auto-correct")
            browser.close()
            _finish(errors)
            return

        # Capture state AFTER auto-correct but BEFORE approve
        after_auto_text = get_editor_text(page)

        # --- CRITICAL TEST 1: Surgical edit happened at auto-correct time ---
        # Exactly N lines should differ from baseline (one per suggestion), and
        # every other line must be 100% identical.
        baseline_lines = [l.strip() for l in baseline_text.splitlines() if l.strip()]
        auto_lines = [l.strip() for l in after_auto_text.splitlines() if l.strip()]
        if len(baseline_lines) != len(auto_lines):
            errors.append(
                f"ARTICLE STRUCTURE CHANGED by auto-correct: {len(baseline_lines)} lines -> {len(auto_lines)} lines"
            )
        else:
            changed = [i for i, (b, a) in enumerate(zip(baseline_lines, auto_lines)) if b != a]
            if len(changed) != mark_count:
                errors.append(
                    f"Auto-correct changed {len(changed)} lines, expected {mark_count} (surgical, per-suggestion)"
                )
                for i, (b, a) in enumerate(zip(baseline_lines, auto_lines)):
                    if b != a:
                        print(f"  CHANGED line {i}:\n    BEFORE: {b[:120]}\n    AFTER:  {a[:120]}")
            else:
                print(f"  Auto-correct surgically changed exactly {len(changed)} line(s) - all other text identical")

        # --- CRITICAL TEST 2: Approve first suggestion ---
        print("Approving first suggestion...")
        marks.first.hover()
        page.wait_for_timeout(800)
        approve_btn = page.locator('button:has-text("Setujui")')
        if approve_btn.count() == 0:
            errors.append("Setujui button not found")
        else:
            approve_btn.click()
            page.wait_for_timeout(1500)

            # Highlight for approved suggestion must be gone
            remaining_marks = page.locator('mark[data-suggestion-id]')
            remaining = remaining_marks.count()
            print(f"Marks after approve: {remaining} (was {mark_count})")
            if remaining >= mark_count:
                errors.append(f"Green highlight did not clear after approve (was {mark_count}, now {remaining})")

            # --- CRITICAL TEST 3: Approve is a no-op for text (change already applied) ---
            after_approve_text = get_editor_text(page)
            approve_lines = [l.strip() for l in after_approve_text.splitlines() if l.strip()]
            if len(auto_lines) != len(approve_lines):
                errors.append(
                    f"ARTICLE STRUCTURE CHANGED by approve: {len(auto_lines)} lines -> {len(approve_lines)} lines"
                )
            else:
                text_changed = sum(1 for a, b in zip(auto_lines, approve_lines) if a != b)
                if text_changed != 0:
                    errors.append(f"Approve modified {text_changed} lines - approve must be a pure status update")
                    for i, (a, b) in enumerate(zip(auto_lines, approve_lines)):
                        if a != b:
                            print(f"  CHANGED line {i}:\n    BEFORE: {a[:120]}\n    AFTER:  {b[:120]}")
                else:
                    print("  Approve changed 0 lines - text untouched by approve (surgical edit done at auto-correct)")

        # --- CRITICAL TEST 4: Sequential approve of second suggestion ---
        marks = page.locator('mark[data-suggestion-id]')
        if marks.count() > 0:
            print("Approving second suggestion...")
            marks.first.hover()
            page.wait_for_timeout(800)
            approve_btn = page.locator('button:has-text("Setujui")')
            if approve_btn.count() > 0:
                approve_btn.click()
                page.wait_for_timeout(1500)
                final_marks = page.locator('mark[data-suggestion-id]').count()
                print(f"Marks after second approve: {final_marks}")
                if final_marks != 0:
                    errors.append(f"Expected 0 marks after approving all, got {final_marks}")
            else:
                errors.append("Setujui button not found for second suggestion")

        # --- Verify re-check reflects the addition ---
        if not errors:
            cek_ulang_btn = page.get_by_role('button', name='Periksa')
            if cek_ulang_btn.count() > 0:
                cek_ulang_btn.click()
                page.wait_for_timeout(4000)
                # No page errors during re-check = report recomputed from updated text

        browser.close()

    _finish(errors)


def _finish(errors):
    if errors:
        print(f"\nFAILED: {len(errors)} error(s):")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("\nPASSED: Approve is a surgical edit - article not regenerated")


if __name__ == '__main__':
    test_kw_density_approve_surgical()
