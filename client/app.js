(function () {
  const state = {
    config: null,
    mode: 'ADMIN', // 'ADMIN' | 'BROKER'
    scopedBrokerId: null,
    lastResult: null,
    adminToken: localStorage.getItem('damien_admin_token') || '',
    requiresAuth: false,
  };

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(msg, type = 'success') {
    const el = document.getElementById('global-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast-banner show ${type}`;
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => {
      el.className = 'toast-banner';
    }, 4500);
  }

  async function copyText(text, label = 'Link') {
    window.__lastCopiedText = text;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch (_err) {
      // Fallback handled via window.__lastCopiedText
    }
    showToast(`Copied ${label}: ${text}`, 'success');
  }

  async function copyQrImageDataUrl(dataUrl) {
    window.__lastCopiedQrDataUrl = dataUrl;
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob }),
        ]);
        showToast('Copied QR Code Image to clipboard! Press Ctrl+V in Email or PowerPoint.', 'success');
        return;
      }
    } catch (_err) {
      // Fallback notification if headless browser blocks ClipboardItem
    }
    showToast('QR Code Image ready for clipboard paste (or click Download QR PNG).', 'success');
  }

  function parseQueryMode() {
    const params = new URLSearchParams(window.location.search);
    const brokerParam = params.get('broker') || params.get('brokerId');
    if (brokerParam && brokerParam.trim()) {
      state.mode = 'BROKER';
      state.scopedBrokerId = brokerParam.trim().toLowerCase();
    } else {
      state.mode = 'ADMIN';
      state.scopedBrokerId = null;
    }
  }

  async function apiFetch(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (state.adminToken) {
      headers['x-admin-token'] = state.adminToken;
    }
    const res = await fetch(url, {
      ...options,
      headers,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Request failed with status ${res.status}`);
    }
    return data;
  }

  function getActiveBrokerForScopedMode() {
    if (!state.config || !state.scopedBrokerId) return null;
    return (
      state.config.brokers.find(
        (b) => b.id.toLowerCase() === state.scopedBrokerId.toLowerCase()
      ) || null
    );
  }

  function renderLayoutAndHeader() {
    const authCard = document.getElementById('admin-auth-card');
    const adminCard = document.getElementById('admin-setup-card');
    const mainGrid = document.getElementById('main-grid');
    const historyCard = document.getElementById('history-card');
    const personaBadge = document.getElementById('persona-badge');
    const logoutBtn = document.getElementById('btn-admin-logout');
    const genTitle = document.getElementById('generator-card-title');
    const genDesc = document.getElementById('generator-card-desc');
    const brokerSelectField = document.getElementById('broker-select-field');
    const scopedBanner = document.getElementById('scoped-broker-banner');
    const historyTitle = document.getElementById('history-card-title');
    const helpAdminSection = document.getElementById('help-admin-section');
    const helpGridContainer = document.getElementById('help-grid-container');

    if (state.mode === 'BROKER') {
      if (helpAdminSection) helpAdminSection.style.display = 'none';
      if (helpGridContainer) helpGridContainer.className = 'portal-grid single-column';
    } else {
      if (helpAdminSection) helpAdminSection.style.display = 'block';
      if (helpGridContainer) helpGridContainer.className = 'portal-grid';
    }

    if (state.mode === 'ADMIN' && state.requiresAuth) {
      if (authCard) authCard.style.display = 'block';
      if (mainGrid) mainGrid.style.display = 'none';
      if (historyCard) historyCard.style.display = 'none';
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (personaBadge) personaBadge.textContent = 'Damien Admin Sign In';
      return;
    }

    if (authCard) authCard.style.display = 'none';
    if (mainGrid) mainGrid.style.display = 'grid';
    if (historyCard) historyCard.style.display = 'block';

    if (state.mode === 'BROKER') {
      if (adminCard) adminCard.style.display = 'none';
      if (mainGrid) mainGrid.className = 'portal-grid single-column';
      if (brokerSelectField) brokerSelectField.style.display = 'none';
      if (logoutBtn) logoutBtn.style.display = 'none';

      const broker = getActiveBrokerForScopedMode();
      const brokerLabel = broker ? broker.name : state.scopedBrokerId;
      if (personaBadge) personaBadge.textContent = `Broker Portal: ${brokerLabel}`;
      if (genTitle) genTitle.textContent = `Generate Employer URL & QR Code — ${brokerLabel}`;
      if (genDesc) {
        genDesc.textContent =
          'Enter an Employer Name below to generate the Indiana (Damien Center) enrollment URL and QR code to paste into your Email or PowerPoint presentation.';
      }
      if (scopedBanner && broker) {
        scopedBanner.style.display = 'flex';
        document.getElementById('scoped-broker-name').textContent = broker.displayLabel || broker.name;
        document.getElementById('scoped-broker-coupon').textContent = broker.couponCode || '(None)';
      }
      if (historyTitle) {
        historyTitle.textContent = `Generated Employer URLs & QR Codes — ${brokerLabel}`;
      }
    } else {
      if (adminCard) adminCard.style.display = 'block';
      if (mainGrid) mainGrid.className = 'portal-grid';
      if (brokerSelectField) brokerSelectField.style.display = 'flex';
      if (scopedBanner) scopedBanner.style.display = 'none';
      if (logoutBtn) logoutBtn.style.display = 'inline-flex';
      if (personaBadge) personaBadge.textContent = 'Damien Admin Portal';
      if (genTitle) genTitle.textContent = '2. Generate Employer URL & QR Code (Any Broker)';
      if (historyTitle) {
        historyTitle.textContent = 'Generated Employer URLs & QR Codes (All Brokers)';
      }
    }
  }

  function renderBrokersTable() {
    const tbody = document.getElementById('brokers-table-body');
    if (!tbody || !state.config) return;

    const rowsHtml = state.config.brokers
      .map((broker) => {
        const brokerLink = `${window.location.origin}/?broker=${encodeURIComponent(broker.id)}`;
        const directBadge = broker.isDirect
          ? `<span class="direct-badge">Direct / No Broker</span>`
          : '';
        const couponText = broker.couponCode
          ? `<code>${escapeHtml(broker.couponCode)}</code>`
          : `<span style="color:#94a3b8;">(No coupon)</span>`;

        const deleteBtnHtml = broker.isDirect
          ? ''
          : `<button type="button" class="btn btn-danger-outline btn-sm" data-delete-broker="${escapeHtml(
              broker.id
            )}" id="btn-delete-broker-${escapeHtml(broker.id)}">Delete</button>`;

        return `
          <tr data-broker-row="${escapeHtml(broker.id)}">
            <td>
              <strong>${escapeHtml(broker.name)}</strong>
              ${directBadge}
            </td>
            <td>${couponText}</td>
            <td>
              <div class="broker-link-cell">
                <a
                  href="${escapeHtml(brokerLink)}"
                  target="_blank"
                  rel="noopener noreferrer"
                  id="link-broker-url-${escapeHtml(broker.id)}"
                  class="broker-url-link"
                  title="Open ${escapeHtml(broker.name)} Portal in new tab"
                >
                  ${escapeHtml(brokerLink)} ↗
                </a>
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  id="btn-copy-broker-link-${escapeHtml(broker.id)}"
                  data-copy-broker-link="${escapeHtml(brokerLink)}"
                  data-broker-name="${escapeHtml(broker.name)}"
                >
                  Copy Broker Link
                </button>
              </div>
            </td>
            <td style="text-align: right;">
              <div class="action-btn-group">
                <button
                  type="button"
                  class="btn btn-secondary btn-sm"
                  id="btn-edit-broker-${escapeHtml(broker.id)}"
                  data-edit-broker="${escapeHtml(broker.id)}"
                >
                  Edit Coupon
                </button>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  id="btn-use-broker-${escapeHtml(broker.id)}"
                  data-use-broker="${escapeHtml(broker.id)}"
                >
                  Generate URL →
                </button>
                ${deleteBtnHtml}
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    tbody.innerHTML = rowsHtml;

    // Attach event listeners
    tbody.querySelectorAll('[data-copy-broker-link]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const link = btn.getAttribute('data-copy-broker-link');
        const name = btn.getAttribute('data-broker-name');
        copyText(link, `Broker Link for ${name}`);
      });
    });

    tbody.querySelectorAll('[data-edit-broker]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-edit-broker');
        startEditBroker(id);
      });
    });

    tbody.querySelectorAll('[data-use-broker]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-use-broker');
        const selectEl = document.getElementById('select-broker');
        if (selectEl) {
          selectEl.value = id;
        }
        const empInput = document.getElementById('input-employer-name');
        if (empInput) {
          empInput.focus();
        }
      });
    });

    tbody.querySelectorAll('[data-delete-broker]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-delete-broker');
        try {
          const data = await apiFetch('/api/brokers/delete', {
            method: 'POST',
            body: JSON.stringify({ id }),
          });
          state.config.brokers = data.brokers;
          if (data.generatedLinks) {
            state.config.generatedLinks = data.generatedLinks;
          }
          renderBrokersTable();
          renderBrokerSelect();
          renderHistoryTable();
          showToast('Broker deleted.', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  function startEditBroker(brokerId) {
    if (!state.config) return;
    const broker = state.config.brokers.find((b) => b.id === brokerId);
    if (!broker) return;

    const idInput = document.getElementById('input-broker-id');
    const nameInput = document.getElementById('input-broker-name');
    const couponInput = document.getElementById('input-broker-coupon');
    const saveBtn = document.getElementById('btn-save-broker');
    const cancelBtn = document.getElementById('btn-cancel-edit');
    const hintEl = document.getElementById('edit-mode-hint');

    idInput.value = broker.id;
    nameInput.value = broker.name;
    nameInput.readOnly = Boolean(broker.isDirect);
    couponInput.value = broker.couponCode || '';
    saveBtn.textContent = `Save Changes (${broker.name})`;
    cancelBtn.style.display = 'inline-flex';
    hintEl.style.display = 'block';
    hintEl.textContent = broker.isDirect
      ? 'Editing Direct Employer Coupon Code for Damien Center (No Broker).'
      : `Editing Broker "${broker.name}" and its Already-Created Coupon Code.`;
    couponInput.focus();
  }

  function resetBrokerForm() {
    const idInput = document.getElementById('input-broker-id');
    const nameInput = document.getElementById('input-broker-name');
    const couponInput = document.getElementById('input-broker-coupon');
    const saveBtn = document.getElementById('btn-save-broker');
    const cancelBtn = document.getElementById('btn-cancel-edit');
    const hintEl = document.getElementById('edit-mode-hint');

    idInput.value = '';
    nameInput.value = '';
    nameInput.readOnly = false;
    couponInput.value = '';
    saveBtn.textContent = '+ Add / Save Broker';
    cancelBtn.style.display = 'none';
    hintEl.style.display = 'none';
    hintEl.textContent = '';
  }

  function renderBrokerSelect() {
    const selectEl = document.getElementById('select-broker');
    if (!selectEl || !state.config) return;

    const currentVal = selectEl.value;
    selectEl.innerHTML = state.config.brokers
      .map((broker) => {
        const label = broker.isDirect
          ? `Damien Center (Direct — No Broker) [Coupon: ${broker.couponCode || 'None'}]`
          : `${broker.name} [Coupon: ${broker.couponCode || 'None'}]`;
        return `<option value="${escapeHtml(broker.id)}">${escapeHtml(label)}</option>`;
      })
      .join('');

    if (state.mode === 'BROKER' && state.scopedBrokerId) {
      selectEl.value = state.scopedBrokerId;
    } else if (currentVal && state.config.brokers.some((b) => b.id === currentVal)) {
      selectEl.value = currentVal;
    } else if (state.config.brokers.length > 0) {
      selectEl.value = state.config.brokers[0].id;
    }
  }

  function displayGeneratedResult(result) {
    state.lastResult = result;
    const box = document.getElementById('generated-output-box');
    if (!box) return;

    box.style.display = 'block';
    document.getElementById('out-employer-name').textContent = result.employerName;
    const outRefEl = document.getElementById('out-ref-code');
    if (outRefEl) {
      outRefEl.textContent = result.refCode || '';
    }
    document.getElementById('out-broker-name').textContent =
      result.brokerId === 'damien'
        ? 'Damien Center (Direct — No Broker)'
        : result.brokerName;
    document.getElementById('out-coupon-code').textContent = result.couponCode || '(None)';

    const urlInput = document.getElementById('output-enrollment-url');
    urlInput.value = result.url;

    const openUrlLink = document.getElementById('link-open-enrollment-url');
    if (openUrlLink) {
      openUrlLink.href = result.url;
      openUrlLink.textContent = `${result.url} ↗`;
    }

    const qrImg = document.getElementById('output-qr-image');
    qrImg.src = result.qrDataUrl;

    const downloadBtn = document.getElementById('btn-download-qr');
    downloadBtn.href = result.qrDownloadUrl;
    downloadBtn.setAttribute(
      'download',
      `QR-DamienCenter-${result.refCode || 'Employer'}.png`
    );

    const pdfFlyerBtn = document.getElementById('btn-download-pdf-flyer');
    if (pdfFlyerBtn) {
      const flyerUrl =
        result.pdfFlyerUrl ||
        `/api/pdf?url=${encodeURIComponent(result.url)}&employer=${encodeURIComponent(
          result.employerName
        )}&ref=${encodeURIComponent(result.refCode || '')}&mode=flyer`;
      pdfFlyerBtn.href = flyerUrl;
      pdfFlyerBtn.setAttribute(
        'download',
        `2027-DC-Weight-Management-Flyer-${result.refCode || 'Employer'}.pdf`
      );
    }

    const pdfPacketBtn = document.getElementById('btn-download-pdf-packet');
    if (pdfPacketBtn) {
      const packetUrl =
        result.pdfPacketUrl ||
        `/api/pdf?url=${encodeURIComponent(result.url)}&employer=${encodeURIComponent(
          result.employerName
        )}&ref=${encodeURIComponent(result.refCode || '')}&mode=packet`;
      pdfPacketBtn.href = packetUrl;
      pdfPacketBtn.setAttribute(
        'download',
        `2027-DC-Weight-Management-Packet-${result.refCode || 'Employer'}.pdf`
      );
    }
  }

  function renderHistoryTable() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody || !state.config) return;

    const allLinks = state.config.generatedLinks || [];
    const filtered =
      state.mode === 'BROKER' && state.scopedBrokerId
        ? allLinks.filter(
            (item) => item.brokerId.toLowerCase() === state.scopedBrokerId.toLowerCase()
          )
        : allLinks;

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center; color:#64748b; padding: 18px;">
            No employer links generated yet. Enter a Business Name above and click <strong>Generate URL &amp; QR Code</strong>.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered
      .map((item) => {
        const brokerLabel =
          item.brokerId === 'damien'
            ? 'Damien Center (Direct — No Broker)'
            : item.brokerName;
        const qrDownloadUrl = `/api/qr.png?url=${encodeURIComponent(
          item.url
        )}&employer=${encodeURIComponent(item.employerName)}&broker=${encodeURIComponent(
          item.brokerName
        )}`;
        const pdfFlyerUrl = `/api/pdf?url=${encodeURIComponent(
          item.url
        )}&employer=${encodeURIComponent(item.employerName)}&ref=${encodeURIComponent(
          item.refCode || ''
        )}&mode=flyer`;
        const pdfPacketUrl = `/api/pdf?url=${encodeURIComponent(
          item.url
        )}&employer=${encodeURIComponent(item.employerName)}&ref=${encodeURIComponent(
          item.refCode || ''
        )}&mode=packet`;

        return `
          <tr data-history-row="${escapeHtml(item.id)}">
            <td><strong>${escapeHtml(item.employerName)}</strong></td>
            <td><code>${escapeHtml(item.refCode || '')}</code></td>
            <td>${escapeHtml(brokerLabel)}</td>
            <td><code>${escapeHtml(item.couponCode || '(None)')}</code></td>
            <td>
              <a
                href="${escapeHtml(item.url)}"
                target="_blank"
                rel="noopener noreferrer"
                class="broker-url-link"
                style="word-break: break-all;"
              >
                ${escapeHtml(item.url)} ↗
              </a>
            </td>
            <td style="text-align: right;">
              <div class="action-btn-group">
                <button
                  type="button"
                  class="btn btn-success btn-sm"
                  data-copy-history-url="${escapeHtml(item.url)}"
                >
                  Copy URL
                </button>
                <a
                  href="${escapeHtml(qrDownloadUrl)}"
                  download="QR-DamienCenter-${escapeHtml(item.refCode)}.png"
                  class="btn btn-secondary btn-sm"
                  style="text-decoration: none;"
                >
                  Download QR
                </a>
                <a
                  href="${escapeHtml(pdfFlyerUrl)}"
                  download="2027-DC-Weight-Management-Flyer-${escapeHtml(item.refCode)}.pdf"
                  class="btn btn-primary btn-sm"
                  style="text-decoration: none;"
                  data-download-flyer-pdf="${escapeHtml(item.refCode)}"
                >
                  1-Page PDF
                </a>
                <a
                  href="${escapeHtml(pdfPacketUrl)}"
                  download="2027-DC-Weight-Management-Packet-${escapeHtml(item.refCode)}.pdf"
                  class="btn btn-secondary btn-sm"
                  style="text-decoration: none;"
                  data-download-packet-pdf="${escapeHtml(item.refCode)}"
                >
                  4-Page PDF
                </a>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    tbody.querySelectorAll('[data-copy-history-url]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const url = btn.getAttribute('data-copy-history-url');
        copyText(url, 'Enrollment URL');
      });
    });
  }

  function wireEvents() {
    const brokerForm = document.getElementById('broker-form');
    if (brokerForm) {
      brokerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('input-broker-id').value.trim();
        const name = document.getElementById('input-broker-name').value.trim();
        const couponCode = document.getElementById('input-broker-coupon').value.trim();

        try {
          const data = await apiFetch('/api/brokers/upsert', {
            method: 'POST',
            body: JSON.stringify({ id: id || undefined, name, couponCode }),
          });
          state.config.brokers = data.brokers;
          resetBrokerForm();
          renderBrokersTable();
          renderBrokerSelect();
          if ( data.broker && document.getElementById('select-broker') ) {
            document.getElementById('select-broker').value = data.broker.id;
          }
          showToast(`Saved Broker "${data.broker.name}" with coupon "${data.broker.couponCode || 'None'}".`, 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    const cancelEditBtn = document.getElementById('btn-cancel-edit');
    if (cancelEditBtn) {
      cancelEditBtn.addEventListener('click', () => {
        resetBrokerForm();
      });
    }

    const genForm = document.getElementById('generator-form');
    if (genForm) {
      genForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const brokerId =
          state.mode === 'BROKER' && state.scopedBrokerId
            ? state.scopedBrokerId
            : document.getElementById('select-broker').value;
        const employerName = document.getElementById('input-employer-name').value.trim();

        if (!employerName) {
          showToast('Please enter an Employer Name.', 'error');
          return;
        }

        try {
          const data = await apiFetch('/api/generate', {
            method: 'POST',
            body: JSON.stringify({ brokerId, employerName }),
          });
          state.config.generatedLinks = data.generatedLinks;
          displayGeneratedResult(data.result);
          renderHistoryTable();
          showToast(`Generated URL & QR Code for "${data.result.employerName}"!`, 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    const copyUrlBtn = document.getElementById('btn-copy-url');
    if (copyUrlBtn) {
      copyUrlBtn.addEventListener('click', () => {
        const url = document.getElementById('output-enrollment-url').value;
        if (url) {
          copyText(url, 'Employer Enrollment URL');
        }
      });
    }

    const copyQrBtn = document.getElementById('btn-copy-qr-image');
    if (copyQrBtn) {
      copyQrBtn.addEventListener('click', () => {
        if (state.lastResult && state.lastResult.qrDataUrl) {
          copyQrImageDataUrl(state.lastResult.qrDataUrl);
        }
      });
    }

    // Admin Login Form
    const loginForm = document.getElementById('admin-login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('input-admin-username').value.trim();
        const password = document.getElementById('input-admin-password').value;
        try {
          const data = await apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
          });
          state.adminToken = data.token;
          localStorage.setItem('damien_admin_token', data.token);
          document.getElementById('input-admin-password').value = '';
          showToast('Signed in to Damien Center Admin Portal.', 'success');
          await loadBootstrap();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    // Toggle to Reset Password Form
    const showResetBtn = document.getElementById('btn-show-reset-password');
    if (showResetBtn) {
      showResetBtn.addEventListener('click', () => {
        document.getElementById('admin-login-form').style.display = 'none';
        document.getElementById('admin-reset-form').style.display = 'flex';
        document.getElementById('auth-card-title').textContent =
          'Reset Damien Admin Password';
        document.getElementById('auth-card-desc').textContent =
          'Enter your email address and choose a new password.';
      });
    }

    const backToLoginBtn = document.getElementById('btn-back-to-login');
    if (backToLoginBtn) {
      backToLoginBtn.addEventListener('click', () => {
        document.getElementById('admin-reset-form').style.display = 'none';
        document.getElementById('admin-login-form').style.display = 'flex';
        document.getElementById('auth-card-title').textContent =
          'Damien Center Admin Sign In';
        document.getElementById('auth-card-desc').textContent =
          'Sign in with your Damien Center Admin credentials to manage brokers, coupons, and all employer enrollment links.';
      });
    }

    // Help & Explainer Guide Toggle
    const toggleHelpBtn = document.getElementById('btn-toggle-help');
    const closeHelpBtn = document.getElementById('btn-close-help');
    const helpCard = document.getElementById('help-explainer-card');
    if (toggleHelpBtn && helpCard) {
      toggleHelpBtn.addEventListener('click', () => {
        const isVisible = helpCard.style.display === 'block';
        helpCard.style.display = isVisible ? 'none' : 'block';
      });
    }
    if (closeHelpBtn && helpCard) {
      closeHelpBtn.addEventListener('click', () => {
        helpCard.style.display = 'none';
      });
    }

    // Admin Reset Password Form (via any @damien.org email)
    const resetForm = document.getElementById('admin-reset-form');
    if (resetForm) {
      resetForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('input-reset-email').value.trim();
        const newPassword = document.getElementById('input-reset-new-password').value.trim();
        try {
          const data = await apiFetch('/api/auth/reset-password', {
            method: 'POST',
            body: JSON.stringify({ email, newPassword }),
          });
          state.adminToken = data.token;
          localStorage.setItem('damien_admin_token', data.token);
          document.getElementById('input-reset-new-password').value = '';
          document.getElementById('admin-reset-form').style.display = 'none';
          document.getElementById('admin-login-form').style.display = 'flex';
          showToast(`Admin password reset via ${data.email} and signed in!`, 'success');
          await loadBootstrap();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    // Admin Sign Out Button
    const logoutBtn = document.getElementById('btn-admin-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        state.adminToken = '';
        localStorage.removeItem('damien_admin_token');
        state.config = null;
        showToast('Signed out of Damien Admin Portal.', 'success');
        await loadBootstrap();
      });
    }
  }

  async function loadBootstrap() {
    try {
      const bootUrl =
        state.mode === 'BROKER' && state.scopedBrokerId
          ? `/api/bootstrap?broker=${encodeURIComponent(state.scopedBrokerId)}`
          : '/api/bootstrap';
      const data = await apiFetch(bootUrl);
      state.requiresAuth = Boolean(data.requiresAuth);
      state.config = data.config;
      renderLayoutAndHeader();
      if (!state.requiresAuth && state.config) {
        renderBrokersTable();
        renderBrokerSelect();
        renderHistoryTable();
      }
    } catch (err) {
      showToast(err.message || 'Failed to load portal configuration.', 'error');
    }
  }

  async function init() {
    parseQueryMode();
    wireEvents();
    await loadBootstrap();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
