import os
import sys
import json
import time
import urllib.request
from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:3005").rstrip("/")
RESULTS_FILE = os.path.join(
    os.path.dirname(__file__),
    "..",
    "docs",
    "playwright_gcp_test_results.json" if "run.app" in BASE_URL else "playwright_local_test_results.json",
)


def run_all_tests():
    results = []

    def record(test_id, title, passed, detail):
        status = "PASS" if passed else "FAIL"
        print(f"[{status}] {test_id}: {title} -> {detail}", flush=True)
        results.append(
            {
                "id": test_id,
                "title": title,
                "passed": passed,
                "detail": detail,
            }
        )
        if not passed:
            raise AssertionError(f"{test_id} FAILED: {detail}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1400, "height": 900})
        page = context.new_page()

        # PW-01: Hard-Coded Damien Center & Single-State Indiana Identity
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        header_text = page.locator("#header-title").inner_text().strip()
        state_badge = page.locator(".pill-state").inner_text().strip()
        with urllib.request.urlopen(f"{BASE_URL}/api/bootstrap") as resp:
            boot = json.loads(resp.read().decode("utf-8"))["config"]
        ok_01 = (
            "Damien Center" in header_text
            and "Indiana" in state_badge
            and boot["ceName"] == "Damien Center"
            and boot["state"] == "Indiana"
            and boot["baseUrl"] == "https://app.helloalpha.com/damien-health"
        )
        record(
            "PW-01",
            "Hard-Coded Damien Center & Single-State Indiana Identity",
            ok_01,
            f"Header='{header_text}', StateBadge='{state_badge}', BaseUrl='{boot['baseUrl']}'",
        )

        # PW-02: Terminology Cleanliness (Zero 'referral' or 'marketing')
        body_text = page.locator("body").inner_text().lower()
        raw_boot = json.dumps(boot).lower()
        prohibited_hits = 0
        for word in ["referral", "referal", "marketing"]:
            if word in body_text or word in raw_boot:
                prohibited_hits += 1
        record(
            "PW-02",
            "Terminology Constraint: Zero Prohibited Word Occurrences",
            prohibited_hits == 0,
            f"Prohibited word count across DOM + Bootstrap JSON = {prohibited_hits}",
        )

        # PW-03: Damien Setup as a Broker for Direct Employers (No Broker)
        first_row = page.locator("#brokers-table-body tr").first.inner_text()
        first_option = page.locator("#select-broker option").first.inner_text()
        ok_03 = (
            "Damien Center" in first_row
            and "Direct / No Broker" in first_row
            and "Damien Center (Direct — No Broker)" in first_option
        )
        record(
            "PW-03",
            "Damien Configured as Direct Broker (For Employers Without a Broker)",
            ok_03,
            f"FirstSelectOption='{first_option}'",
        )

        # PW-04: Damien Generates URL & QR Code for Direct Employer (No Broker)
        page.select_option("#select-broker", "damien")
        page.fill("#input-employer-name", "Indiana Pacers")
        with page.expect_response(lambda r: "/api/generate" in r.url and r.status == 200):
            page.click("#btn-generate")
        page.wait_for_selector("#generated-output-box", state="visible")
        gen_url = page.input_value("#output-enrollment-url")
        qr_src = page.get_attribute("#output-qr-image", "src") or ""
        expected_direct_url = "https://app.helloalpha.com/damien-health?ref=DamienCenterIndianaPacers&coupon=firstmonthDamien"
        ok_04 = gen_url == expected_direct_url and qr_src.startswith("data:image/png;base64,")
        record(
            "PW-04",
            "Damien Generates URL & QR Code for Direct Employer (No Broker)",
            ok_04,
            f"URL='{gen_url}', QRDataUrlLen={len(qr_src)}",
        )

        # PW-05: Damien Edits Direct Employer Coupon Code & Restores
        page.click("#btn-edit-broker-damien")
        page.fill("#input-broker-coupon", "firstmonthDamienUpdated")
        with page.expect_response(lambda r: "/api/brokers/upsert" in r.url and r.status == 200):
            page.click("#btn-save-broker")
        page.reload(wait_until="networkidle")
        updated_first_row = page.locator("#brokers-table-body tr").first.inner_text()
        # Restore to firstmonthDamien
        page.click("#btn-edit-broker-damien")
        page.fill("#input-broker-coupon", "firstmonthDamien")
        with page.expect_response(lambda r: "/api/brokers/upsert" in r.url and r.status == 200):
            page.click("#btn-save-broker")
        restored_first_row = page.locator("#brokers-table-body tr").first.inner_text()
        ok_05 = "firstmonthDamienUpdated" in updated_first_row and "firstmonthDamien" in restored_first_row
        record(
            "PW-05",
            "Damien Can Update Direct Employer Coupon Code & Persist",
            ok_05,
            "Updated to 'firstmonthDamienUpdated' and restored to 'firstmonthDamien'",
        )

        # PW-06: Damien Adds a New Broker with Already-Created Coupon Code
        page.fill("#input-broker-name", "Apex Benefit Group")
        page.fill("#input-broker-coupon", "firstmonthApex")
        with page.expect_response(lambda r: "/api/brokers/upsert" in r.url and r.status == 200):
            page.click("#btn-save-broker")
        page.wait_for_selector("tr[data-broker-row='apex-benefit-group']", state="visible")
        # Verify in isolated context
        ctx2 = browser.new_context()
        p2 = ctx2.new_page()
        p2.goto(f"{BASE_URL}/", wait_until="networkidle")
        row_text = p2.locator("tr[data-broker-row='apex-benefit-group']").inner_text()
        ctx2.close()
        ok_06 = "Apex Benefit Group" in row_text and "firstmonthApex" in row_text
        record(
            "PW-06",
            "Damien Adds Broker with Already-Created Coupon Code & Persists",
            ok_06,
            f"Saved Broker Row='{row_text.replace(chr(10), ' ')}'",
        )

        # PW-07: Damien Copies Delegated Broker Link (/?broker=...)
        page.click("#btn-copy-broker-link-lhd")
        copied_lhd_link = page.evaluate("window.__lastCopiedText")
        page.click("#btn-copy-broker-link-apex-benefit-group")
        copied_apex_link = page.evaluate("window.__lastCopiedText")
        ok_07 = (
            copied_lhd_link == f"{BASE_URL}/?broker=lhd"
            and copied_apex_link == f"{BASE_URL}/?broker=apex-benefit-group"
        )
        record(
            "PW-07",
            "Damien Copies Broker Portal Links (/?broker=<id>)",
            ok_07,
            f"LHD='{copied_lhd_link}', Apex='{copied_apex_link}'",
        )

        # PW-08: Damien Generates URL & QR Code for Any External Broker (LHD Benefit Advisors)
        page.select_option("#select-broker", "lhd")
        page.fill("#input-employer-name", "Cummins Inc")
        with page.expect_response(lambda r: "/api/generate" in r.url and r.status == 200):
            page.click("#btn-generate")
        lhd_url = page.input_value("#output-enrollment-url")
        expected_lhd_url = "https://app.helloalpha.com/damien-health?ref=LHDBenefitAdvisorsCumminsInc&coupon=firstmonthlhd"
        ok_08 = lhd_url == expected_lhd_url
        record(
            "PW-08",
            "Damien Generates Employer URL & QR Code for Existing Broker (LHD)",
            ok_08,
            f"URL='{lhd_url}'",
        )

        # PW-09: Damien Generates URL & QR Code for Newly Added Broker (Apex Benefit Group)
        page.select_option("#select-broker", "apex-benefit-group")
        page.fill("#input-employer-name", "Roche Diagnostics")
        with page.expect_response(lambda r: "/api/generate" in r.url and r.status == 200):
            page.click("#btn-generate")
        apex_url = page.input_value("#output-enrollment-url")
        expected_apex_url = "https://app.helloalpha.com/damien-health?ref=ApexBenefitGroupRocheDiagnostics&coupon=firstmonthApex"
        ok_09 = apex_url == expected_apex_url
        record(
            "PW-09",
            "Damien Generates Employer URL & QR Code for Newly Added Broker",
            ok_09,
            f"URL='{apex_url}'",
        )

        # PW-10: Manual Copy URL, Copy QR Image & Download High-Res QR PNG for Email / PPT
        page.click("#btn-copy-url")
        copied_gen_url = page.evaluate("window.__lastCopiedText")
        page.click("#btn-copy-qr-image")
        copied_qr_data = page.evaluate("window.__lastCopiedQrDataUrl") or ""
        qr_href = page.get_attribute("#btn-download-qr", "href")
        with urllib.request.urlopen(f"{BASE_URL}{qr_href}") as qr_resp:
            png_bytes = qr_resp.read()
            content_type = qr_resp.headers.get("Content-Type", "")
        ok_10 = (
            copied_gen_url == expected_apex_url
            and copied_qr_data.startswith("data:image/png;base64,")
            and content_type == "image/png"
            and png_bytes[:4] == b"\x89PNG"
            and len(png_bytes) > 1000
        )
        record(
            "PW-10",
            "Manual Copy URL, Copy QR Image & Download QR PNG for Email and PPT",
            ok_10,
            f"CopiedURL=True, CopiedQRImage=True, PNGBytes={len(png_bytes)}",
        )

        # PW-11: Broker Self-Service Portal View (/?broker=lhd) — UI Isolation
        broker_ctx = browser.new_context(viewport={"width": 1280, "height": 850})
        broker_page = broker_ctx.new_page()
        broker_page.goto(f"{BASE_URL}/?broker=lhd", wait_until="networkidle")
        admin_card_visible = broker_page.locator("#admin-setup-card").is_visible()
        select_field_visible = broker_page.locator("#broker-select-field").is_visible()
        scoped_banner_visible = broker_page.locator("#scoped-broker-banner").is_visible()
        scoped_broker_name = broker_page.locator("#scoped-broker-name").inner_text().strip()
        scoped_coupon = broker_page.locator("#scoped-broker-coupon").inner_text().strip()
        ok_11 = (
            not admin_card_visible
            and not select_field_visible
            and scoped_banner_visible
            and scoped_broker_name == "LHD Benefit Advisors"
            and scoped_coupon == "firstmonthlhd"
        )
        record(
            "PW-11",
            "Broker Self-Service View (/?broker=lhd) Hides Admin Setup & Locks to Broker",
            ok_11,
            f"AdminHidden={not admin_card_visible}, Broker='{scoped_broker_name}', Coupon='{scoped_coupon}'",
        )

        # PW-12: Broker Self-Service View (/?broker=lhd) — Generate Employer URL & QR Code
        broker_page.fill("#input-employer-name", "Eli Lilly & Co.")
        with broker_page.expect_response(lambda r: "/api/generate" in r.url and r.status == 200):
            broker_page.click("#btn-generate")
        broker_page.wait_for_selector("#generated-output-box", state="visible")
        broker_gen_url = broker_page.input_value("#output-enrollment-url")
        broker_qr_src = broker_page.get_attribute("#output-qr-image", "src") or ""
        expected_lilly_url = "https://app.helloalpha.com/damien-health?ref=LHDBenefitAdvisorsEliLillyCo&coupon=firstmonthlhd"
        ok_12 = (
            broker_gen_url == expected_lilly_url
            and broker_qr_src.startswith("data:image/png;base64,")
        )
        record(
            "PW-12",
            "Broker Self-Service View Generates Employer URL & QR Code for Email/PPT",
            ok_12,
            f"URL='{broker_gen_url}'",
        )
        broker_ctx.close()

        # PW-13: Second Broker Self-Service View (/?broker=mgb) — History Isolation & Generation
        mgb_ctx = browser.new_context(viewport={"width": 1280, "height": 850})
        mgb_page = mgb_ctx.new_page()
        mgb_page.goto(f"{BASE_URL}/?broker=mgb", wait_until="networkidle")
        history_before = mgb_page.locator("#history-table-body").inner_text()
        lhd_leaked = "Eli Lilly" in history_before or "Cummins" in history_before
        mgb_page.fill("#input-employer-name", "Sub-Zero Group")
        with mgb_page.expect_response(lambda r: "/api/generate" in r.url and r.status == 200):
            mgb_page.click("#btn-generate")
        mgb_page.wait_for_selector("#generated-output-box", state="visible")
        mgb_url = mgb_page.input_value("#output-enrollment-url")
        expected_mgb_url = "https://app.helloalpha.com/damien-health?ref=McGohanBrabenderSubZeroGroup&coupon=firstmonthMB"
        ok_13 = not lhd_leaked and mgb_url == expected_mgb_url
        record(
            "PW-13",
            "Second Broker View (/?broker=mgb) Isolates History & Uses MGB Coupon",
            ok_13,
            f"LHDLeaked={lhd_leaked}, URL='{mgb_url}'",
        )
        mgb_ctx.close()

        # PW-14: Direct Broker Self-Service View (/?broker=damien)
        direct_ctx = browser.new_context(viewport={"width": 1280, "height": 850})
        direct_page = direct_ctx.new_page()
        direct_page.goto(f"{BASE_URL}/?broker=damien", wait_until="networkidle")
        direct_page.fill("#input-employer-name", "Indianapolis Motor Speedway")
        with direct_page.expect_response(lambda r: "/api/generate" in r.url and r.status == 200):
            direct_page.click("#btn-generate")
        direct_page.wait_for_selector("#generated-output-box", state="visible")
        ims_url = direct_page.input_value("#output-enrollment-url")
        expected_ims_url = "https://app.helloalpha.com/damien-health?ref=DamienCenterIndianapolisMotorSpeedway&coupon=firstmonthDamien"
        ok_14 = ims_url == expected_ims_url
        record(
            "PW-14",
            "Direct Broker Self-Service Link (/?broker=damien) Works for Direct Employers",
            ok_14,
            f"URL='{ims_url}'",
        )
        direct_ctx.close()

        # PW-15: Protect Built-in Direct Broker & Cleanup Test Broker
        page.goto(f"{BASE_URL}/", wait_until="networkidle")
        del_direct_status = page.evaluate(
            """async () => {
                const r = await fetch('/api/brokers/delete', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ id: 'damien' })
                });
                return r.status;
            }"""
        )
        with page.expect_response(lambda r: "/api/brokers/delete" in r.url and r.status == 200):
            page.click("#btn-delete-broker-apex-benefit-group")
        apex_count = page.locator("tr[data-broker-row='apex-benefit-group']").count()
        ok_15 = del_direct_status == 400 and apex_count == 0
        record(
            "PW-15",
            "Built-in Direct Broker Protected & Test Broker Deleted Cleanly",
            ok_15,
            f"DirectDeleteStatus={del_direct_status}, ApexRemaining={apex_count}",
        )

        browser.close()

    os.makedirs(os.path.dirname(RESULTS_FILE), exist_ok=True)
    summary = {
        "baseUrl": BASE_URL,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total": len(results),
        "passed": sum(1 for r in results if r["passed"]),
        "failed": sum(1 for r in results if not r["passed"]),
        "results": results,
    }
    with open(RESULTS_FILE, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print(
        f"\nSUMMARY: {summary['passed']}/{summary['total']} PASSED ({summary['failed']} FAILURES)",
        flush=True,
    )


if __name__ == "__main__":
    run_all_tests()
