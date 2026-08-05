"""
Debug test: Check AI response and validation for keyword density auto-correct
"""

from playwright.sync_api import sync_playwright
import sys
import json

TEST_ARTICLE = """# Naik Skala Bisnis? Wajib Lakukan Perubahan Data OSS Perusahaan

*"Bisnis Anda naik kelas dari Menengah ke Skala Besar?"*

Saat perusahaan Anda tumbuh dan naik kelas dari usaha menengah menjadi skala besar, ada satu kewajiban yang tidak boleh dilewatkan: melakukan perubahan data OSS perusahaan. Hal ini karena sistem OSS menggunakan berbagai data, seperti skala usaha, nilai investasi, serta bidang usaha, untuk menetapkan klasifikasi risiko.

Klasifikasi risiko menentukan jenis perizinan berusaha yang harus dimiliki. Semakin besar skala usaha, semakin ketat pula pengawasan dan persyaratan yang berlaku. Oleh karena itu, pemutakhiran data menjadi langkah pertama yang krusial.

Perubahan data OSS perusahaan dapat dilakukan melalui akun lembaga OSS di laman oss.go.id. Pemilik usaha cukup melengkapi formulir dan mengunggah dokumen pendukung yang dipersyaratkan. Pastikan seluruh data diperbarui sesuai kondisi riil di lapangan agar tidak menimbulkan sanksi.

Dengan memperbarui data secara tertib, perusahaan dapat melanjutkan kegiatan usahanya tanpa hambatan dan tetap patuh terhadap peraturan perundang-undangan yang berlaku."""

console_logs = []

def handle_console(msg):
    text = msg.text
    console_logs.append(f"[{msg.type}] {text}")
    if 'KW Density' in text or 'DEBUG' in text or 'Auto Correct' in text or 'suggestion' in text.lower() or 'valid' in text.lower() or 'parsed' in text.lower():
        print(f"  >> {text}")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1920, 'height': 1080})
    page.on("console", handle_console)
    page.on("pageerror", lambda err: console_logs.append(f"[PAGE_ERROR] {err}"))

    page.goto('http://localhost:5173')
    page.wait_for_load_state('domcontentloaded')
    page.wait_for_timeout(2000)

    # Type article
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

    # Set keyword
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

    # Click Periksa
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

    # Click Auto Correct on SEO card (identified by its title attr, not the first sparkles button)
    auto_correct_btn = page.locator('button[title*="Auto Correct: sisipkan keyword"]')
    if auto_correct_btn.count() > 0:
        print("\nClicking Auto Correct...")
        auto_correct_btn.click()
        
        # Wait longer for AI response
        page.wait_for_timeout(20000)

    # Check for green suggestion marks in editor
    marks = page.locator('mark[data-suggestion-id]')
    print(f"\nSuggestion marks in editor: {marks.count()}")
    for i in range(marks.count()):
        m = marks.nth(i)
        print(f"  mark[{i}]: class={m.get_attribute('class')} id={m.get_attribute('data-suggestion-id')} text='{m.inner_text()}'")

    # Test approve flow first (keep change), then verify text unchanged by approve
    if marks.count() > 0:
        first_mark_text = marks.first.inner_text()
        print(f"\nInserted text that was marked: '{first_mark_text}'")
        text_before_approve = page.locator('.ProseMirror').inner_text()
        print("Hovering first suggestion mark...")
        marks.first.hover()
        page.wait_for_timeout(800)
        approve_btn = page.locator('button:has-text("Setujui")')
        print(f"Approve button present: {approve_btn.count() > 0}")
        if approve_btn.count() > 0:
            approve_btn.click()
            page.wait_for_timeout(1500)
            remaining = page.locator('mark[data-suggestion-id]')
            print(f"Suggestion marks after approve: {remaining.count()}")
            text_after_approve = page.locator('.ProseMirror').inner_text()
            print(f"Editor TEXT identical after approve (mark removal only changes HTML): {text_before_approve == text_after_approve}")

    browser.close()

print("\n" + "="*60)
print("ALL CONSOLE LOGS:")
print("="*60)
for log in console_logs:
    print(log)