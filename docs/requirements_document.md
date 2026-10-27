# Requirements Document: Damien Center (Indiana) — Broker & Employer Link + QR Generator

## 1. Source Requirement Checklist
1. **REQ-01**: Isolated new repository (`rishibridge/damien-link-generator`), new app, and new Cloud Run URL (`damien-link-generator`).
2. **REQ-02**: Simple Broker setup + delegated Broker link (`/?broker=<id>`) to generate Employer Enrollment URL and QR code ("bar code") to manually copy and paste into Email and PowerPoint.
3. **REQ-03**: Hard-coded to **Damien Center** (`https://app.helloalpha.com/damien-health`) and single-state (**Indiana**).
4. **REQ-04**: Damien enters the **already-created coupon code** for each Broker when setting up or editing a Broker.
5. **REQ-05**: Damien is pre-configured as a Broker (`Damien Center (Direct — No Broker)`) for employers that do not use an external broker.
6. **REQ-06**: Damien can generate Employer Enrollment URLs and QR codes for **any Employer** under **any Broker** (including Direct / No Broker) directly from the Admin Portal (`/`).
7. **REQ-07**: Manual copy/paste output: 1-click **Copy URL**, 1-click **Copy QR Image to Clipboard**, and 1-click **Download QR PNG**.
8. **REQ-08**: Terminology cleanliness (zero occurrences of prohibited words).
