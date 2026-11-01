"""Headless Chrome: submit the consent form once and assert the browser lands on the client callback."""
import sys
from playwright.sync_api import sync_playwright
gw = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=sys.argv[2] if len(sys.argv) > 2 else None, args=['--no-proxy-server'])
    pg = b.new_page()
    blocked = []
    pg.on('console', lambda m: blocked.append(m.text) if 'Content Security Policy' in m.text else None)
    pg.goto(gw + '/authorize?x=1')
    pg.fill('input[name=passphrase]', 'browser-test-pass')
    pg.click('button[value=approve]')
    pg.wait_for_timeout(1500)
    print('final URL:', pg.url)
    print('csp violations:', blocked[:1])
    ok = '/callback?code=CODE123' in pg.url
    print('BROWSER_CONSENT_PASS' if ok else 'BROWSER_CONSENT_FAIL')
    b.close()
    sys.exit(0 if ok else 1)
