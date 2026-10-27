# Damien Center (Indiana) — Broker & Employer Enrollment Link + QR Code Portal

A dedicated, single-state (Indiana) web application hard-coded to **Damien Center** (`https://app.helloalpha.com/damien-health`) for managing Broker coupon codes and generating Employer Enrollment URLs and QR Codes ("bar codes") ready to copy and paste into Email and PowerPoint presentations.

## Key Capabilities
1. **Damien Admin View (`/`)**:
   - **Broker & Coupon Setup**: Add or update Brokers and enter the **Already-Created Coupon Code** for each Broker.
   - **Direct Employers (No Broker)**: Pre-configured **Damien Center (Direct — No Broker)** broker entry so Damien can generate URLs and QR codes for employers that do not use an external broker.
   - **Delegated Broker Links**: Copy a dedicated self-service link (`/?broker=<id>`) for any Broker.
   - **Universal Employer URL & QR Generator**: Damien can select **any Broker** (including Direct / No Broker) and enter **any Employer Name** to generate the Enrollment URL and QR code on the spot.
2. **Broker Self-Service View (`/?broker=<id>`)**:
   - Scoped strictly to that Broker (hides admin setup and other brokers).
   - Broker enters an **Employer Name** and clicks **Generate URL & QR Code**.
   - Provides 1-click **Copy URL**, 1-click **Copy QR Image to Clipboard** (for direct paste into Email and PowerPoint), and 1-click **Download QR PNG**.
