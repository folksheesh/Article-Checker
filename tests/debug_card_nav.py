"""
Debug: Verify card-click navigation for fixable issues.
Hypothesis: AI problematic_text is quoted from MARKDOWN article, but editor
renders HTML -> plain text differs (markdown chars, smart quotes, line breaks),
so exact indexOf / includes validation fails and navigation silently does nothing.
"""

from playwright.sync_api import sync_playwright
import json

TEST_ARTICLE = """# Judul Artikel: Perizinan Berusaha

*"Bisnis Anda naik kelas dari Menengah ke Skala Besar?"*

Hal ini karena sistem OSS menggunakan berbagai data, seperti skala usaha, nilai investasi, serta bidang usaha, untuk menetapkan klasifikasi risiko.

Perizinan **berusaha berbasis risiko** adalah kewajiban utama. Semakin besar skala usaha, semakin ketat pula pengawasan dan persyaratan yang berlaku. Pemilik usaha wajibupdate data secara tertib agar tidak menimbulkan sanksi.

Oleh karena itu, pemilik usaha wajib memperbarui data secara tertib agar tidak menimbulkan sanksi."""

console_logs = []

def handle_console(msg):
    text = msg.text
    console_logs.append(f"[{msg.type}] {text}")
    if ('CARD NAV' in text or 'focusIssue' in text or 'focusOnMark' in text
            or 'navigat' in text.lower() or 'selected' in text.lower()
            or 'mark' in text.lower() or 'GAGAL' in text or 'FAIL' in text):
        print(f"  >> {text}")

def js_click(page, locator, label):
    """Dispatch a native click via JS to bypass pointer-event overlay interception."""
    try:
        locator.dispatch_event('click')
        page.wait_for_timeout(800)
        diag = page.evaluate("""() => {
          const s = window.getSelection();
          const sel = s && s.rangeCount ? s.toString().slice(0, 90) : '';
          const active = document.querySelectorAll('mark.issue-highlight-active').length;
          const marks = document.querySelectorAll('mark[data-issue-ids], mark[data-issue-id]').length;
          let flash = '';
          const f = document.querySelector('[data-flash-text], .flash-text');
          if (f) flash = f.textContent.slice(0, 60);
          const selLen = sel.length;
          return { sel, selLen, active, marks, flash };
        }""")
        print(f"  [DIAG] {label}: selection='{diag['sel']}' selLen={diag['selLen']} active_marks={diag['active']} total_marks={diag['marks']} flash='{diag['flash']}'")
        return diag
    except Exception as e:
        print(f"  [DIAG] {label}: ERROR {e}")
        return None

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
    page.wait_for_timeout(100)
    page.keyboard.press('Delete')
    page.wait_for_timeout(100)
    page.keyboard.insert_text('perizinan berusaha berbasis risiko')
    page.wait_for_timeout(300)

    periksa_btn = page.get_by_role('button', name='Periksa')
    periksa_btn.wait_for(state='visible', timeout=5000)
    periksa_btn.click()
    page.wait_for_timeout(20000)
    try:
        page.wait_for_function(
            "() => document.querySelectorAll('button:has(svg.lucide-target)').length > 0",
            timeout=40000
        )
    except:
        pass
    page.wait_for_timeout(2000)

    ai_area = page.locator('text=Analisis AI').count()
    print(f"[DEBUG] 'Analisis AI' text count: {ai_area}")

    # Diagnose AI eval state
    state = page.evaluate("""() => {
      const body = document.body.innerText;
      const aiEval = body.indexOf('AI Evaluation');
      const emptyState = body.indexOf('Klik Periksa untuk melihat hasil');
      const errorBanner = body.indexOf('Gagal') !== -1 || body.indexOf('Error') !== -1 || body.indexOf('gagal') !== -1;
      const hasBtn = document.querySelectorAll('div[role="button"]').length;
      const aiCards = document.querySelectorAll('div[role="button"]').length;
      let errorText = '';
      const err = document.querySelector('[data-error-message], .error-banner, [role="alert"]');
      if (err) errorText = err.textContent.slice(0, 120);
      return { aiEvalIdx: aiEval, emptyStateIdx: emptyState, errorBanner, hasBtn, aiCards, errorText };
    }""")
    print(f"[DEBUG] AI eval state: {state}")

    # Also dump any text around 'Analisis' / 'AI Evaluation' section
    sec = page.evaluate("""() => {
      const el = Array.from(document.querySelectorAll('h3')).find(h => h.textContent.includes('AI Evaluation'));
      return el ? el.parentElement.innerText.slice(0, 400) : '(no AI Evaluation h3)';
    }""")
    print(f"[DEBUG] AI section text: {sec[:300]}")


    # Category cards (Daftar Issue) - native click via JS
    cat_btns = page.locator('button:has-text("Lead"), button:has-text("Paragraf"), button:has-text("Heading"), button:has-text("Isi Tubuh"), button:has-text("Bahasa"), button:has-text("CTA"), button:has-text("Judul"), button:has-text("SEO")')
    count = cat_btns.count()
    print(f"[DEBUG] Category buttons: {count}")
    for c in range(min(count, 10)):
        label = cat_btns.nth(c).inner_text().split('\n')[0].strip()[:30]
        print(f"\n[DEBUG] Clicking cat[{c}]: '{label}'")
        js_click(page, cat_btns.nth(c), f"cat[{c}]:{label}")

    # Click AI result cards (div[role=button]) and verify navigation to correct text
    ai_card_btns = page.locator('div[role="button"]')
    n = ai_card_btns.count()
    print(f"\n[DEBUG] AI result cards: {n}")
    for c in range(n):
        txt = ai_card_btns.nth(c).inner_text()[:80]
        print(f"\n[DEBUG] Clicking AI card[{c}]: '{txt}'")
        js_click(page, ai_card_btns.nth(c), f"ai[{c}]:{txt[:30]}")

    browser.close()

print("\n" + "="*60)
print("ALL CONSOLE LOGS:")
print("="*60)
for log in console_logs:
    print(log)
