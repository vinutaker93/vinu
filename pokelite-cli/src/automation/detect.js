// Ce fichier exporte UNE fonction autonome (aucune closure sur le reste du
// module) destinée à `context.addInitScript()` : Playwright la sérialise et
// l'exécute dans CHAQUE page du navigateur, avant tout script du site, et ce
// à chaque navigation (y compris les rechargements WooCommerce après un
// submit). Elle installe `window.__pokelite`, dont les méthodes sont ensuite
// appelées depuis Node via `page.evaluate(() => window.__pokelite.xxx(...))`.
//
// La logique de détection (case à cocher masquée, bouton "Je participe",
// confirmation de participation) est un port direct des heuristiques de
// content.js (extension Chrome) — c'est du DOM JS pur, aucune API Chrome.
export function installPokeliteHelpers() {
  function collectRoots(root, acc) {
    root = root || document;
    acc = acc || [];
    acc.push(root);
    const all = root.querySelectorAll ? root.querySelectorAll('*') : [];
    all.forEach((el) => {
      if (el.shadowRoot) collectRoots(el.shadowRoot, acc);
    });
    return acc;
  }

  function $$(sel, root) {
    const out = [];
    collectRoots(root).forEach((r) => {
      try {
        r.querySelectorAll(sel).forEach((el) => out.push(el));
      } catch (_) {}
    });
    return out;
  }

  function textOf(el) {
    if (!el) return '';
    const parts = [
      el.textContent || '',
      el.value || '',
      el.getAttribute && (el.getAttribute('aria-label') || ''),
      el.getAttribute && (el.getAttribute('title') || ''),
    ];
    return parts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    return rect.width > 0 || rect.height > 0 || el.type === 'checkbox';
  }

  function findByText(selectors, fragments, root) {
    const frags = fragments.map((f) => f.toLowerCase());
    const els = $$(selectors, root);
    const matches = els.filter((el) => {
      const t = textOf(el);
      return t && frags.some((f) => t.includes(f));
    });
    matches.sort((a, b) => {
      const va = isVisible(a) ? 0 : 1;
      const vb = isVisible(b) ? 0 : 1;
      if (va !== vb) return va - vb;
      return textOf(a).length - textOf(b).length;
    });
    return matches[0] || null;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function waitFor(fn, timeout, interval) {
    timeout = timeout || 12000;
    interval = interval || 250;
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        let res = null;
        try {
          res = fn();
        } catch (_) {}
        if (res) return resolve(res);
        if (Date.now() - start >= timeout) return resolve(null);
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  function isLoggedIn() {
    return (
      !!document.querySelector('.woocommerce-MyAccount-navigation, a[href*="customer-logout"]') ||
      !!findByText('a', ['déconnexion', 'deconnexion', 'logout', 'log out'])
    );
  }

  function setVal(input, val) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // --- Case à cocher --------------------------------------------------
  const CHECKBOX_HINTS = [
    'particip', 'je participe', 'tirage', 'conditions', 'règlement', 'reglement',
    'accepte', 'j’accepte', "j'accepte", 'consens', 'inscription au tirage',
  ];

  function labelTextFor(cb) {
    const bits = [];
    if (cb.id) $$(`label[for="${CSS.escape(cb.id)}"]`).forEach((l) => bits.push(l.textContent || ''));
    const parentLabel = cb.closest('label');
    if (parentLabel) bits.push(parentLabel.textContent || '');
    const wrapper = cb.closest('.form-row, .checkbox, li, p, div');
    if (wrapper) bits.push(wrapper.textContent || '');
    bits.push(cb.name || '', cb.id || '', cb.getAttribute('aria-label') || '');
    return bits.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function findCustomCheckbox() {
    const sel = '[role="checkbox"], .checkbox-custom, .custom-checkbox, .wpcf7-list-item-label, .checkmark';
    const els = $$(sel).filter(isVisible);
    const hinted = els.find((el) => {
      const t = textOf(el.closest('label, div, li, p') || el);
      return CHECKBOX_HINTS.some((h) => t.includes(h));
    });
    return hinted || els[0] || null;
  }

  function findCheckbox() {
    const boxes = $$('input[type="checkbox"]').filter((cb) => !cb.disabled);
    if (boxes.length === 0) return findCustomCheckbox();

    const scored = boxes
      .map((cb) => {
        const t = labelTextFor(cb);
        const hit = CHECKBOX_HINTS.findIndex((h) => t.includes(h));
        return { cb, score: hit === -1 ? 99 : hit };
      })
      .sort((a, b) => a.score - b.score);
    if (scored[0] && scored[0].score < 99) return scored[0].cb;

    const btn = findParticipateButton();
    if (btn) {
      const form = btn.closest('form, .elementor-widget-container, section, div');
      if (form) {
        const inForm = boxes.find((cb) => form.contains(cb));
        if (inForm) return inForm;
      }
    }
    return boxes.find((cb) => !cb.checked) || boxes[0] || findCustomCheckbox();
  }

  function isChecked(cb) {
    if (!cb) return false;
    if (typeof cb.checked === 'boolean' && cb.type === 'checkbox') return cb.checked;
    return cb.getAttribute('aria-checked') === 'true' || cb.classList.contains('checked');
  }

  async function ensureChecked(cb) {
    if (!cb) return false;
    if (isChecked(cb)) return true;

    const attempts = [() => cb.click()];
    if (cb.id) {
      const lab = $$(`label[for="${CSS.escape(cb.id)}"]`)[0];
      if (lab) attempts.push(() => lab.click());
    }
    const parentLabel = cb.closest('label');
    if (parentLabel) attempts.push(() => parentLabel.click());
    const sibling = cb.parentElement && cb.parentElement.querySelector('span, i, .checkmark');
    if (sibling) attempts.push(() => sibling.click());
    attempts.push(() => {
      cb.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      cb.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      cb.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    attempts.push(() => {
      if (cb.type === 'checkbox') {
        cb.checked = true;
        cb.setAttribute('checked', 'checked');
      } else {
        cb.setAttribute('aria-checked', 'true');
        cb.classList.add('checked');
      }
      cb.dispatchEvent(new Event('input', { bubbles: true }));
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });

    for (const attempt of attempts) {
      try {
        cb.scrollIntoView({ block: 'center' });
      } catch (_) {}
      try {
        attempt();
      } catch (_) {}
      await sleep(200);
      if (isChecked(cb)) return true;
    }
    return isChecked(cb);
  }

  // --- Bouton « Je participe » -----------------------------------------
  const PARTICIPATE_HINTS = [
    'je participe', 'participer au tirage', 'participer', 'participate',
    'valider ma participation', 'je tente ma chance', 'tenter ma chance',
    's’inscrire au tirage', "s'inscrire au tirage",
  ];

  function findParticipateButton() {
    const direct = findByText(
      'button, input[type="submit"], input[type="button"], a, [role="button"], .button, .elementor-button',
      PARTICIPATE_HINTS
    );
    if (direct) return direct;
    return document.querySelector('button[name="add-to-cart"], .single_add_to_cart_button');
  }

  function participationConfirmed() {
    const body = (document.body.innerText || '').toLowerCase();
    return (
      /particip(ation|ez)?\s*(bien\s*)?(enregistr|valid|pris)/.test(body) ||
      body.includes('merci pour votre participation') ||
      body.includes('vous participez') ||
      body.includes('déjà participé') ||
      body.includes('deja participe') ||
      !!document.querySelector('.woocommerce-message, .woocommerce-info')
    );
  }

  function productName() {
    const el = document.querySelector('h1.product_title, .product_title, h1.entry-title, h1');
    return (el && el.textContent.trim()) || document.title.split('–')[0].trim() || '—';
  }

  function productImage() {
    const img = document.querySelector(
      '.woocommerce-product-gallery__image img, .wp-post-image, meta[property="og:image"]'
    );
    if (!img) return null;
    return img.tagName === 'META' ? img.getAttribute('content') : img.currentSrc || img.src;
  }

  // --- Entrées appelées depuis Node via page.evaluate --------------------
  window.__pokelite = {
    isLoggedIn,

    // Page /mon-compte/ non connectée : remplit l'email et soumet le
    // formulaire d'inscription (si autoSubmit est vrai).
    fillEmailAndSubmit(email, autoSubmit) {
      const emailInputs = $$('input[type="email"], input[name*="email" i]').filter(isVisible);
      if (emailInputs.length === 0) return { ok: false, reason: 'no-email-field' };

      let target = null;
      for (const input of emailInputs) {
        const form = input.closest('form');
        if (!form) continue;
        if (findByText('button, input[type="submit"]', ['inscri', 'sign up', "s'inscrire"], form)) {
          target = input;
          break;
        }
      }
      if (!target) target = emailInputs[emailInputs.length - 1];
      if (target.value !== email) setVal(target, email);

      const form = target.closest('form');
      const submitBtn =
        findByText('button, input[type="submit"]', ['inscri', 'sign up', "s'inscrire"], form || document) ||
        (form && form.querySelector('button[type="submit"], input[type="submit"]'));

      if (autoSubmit && submitBtn) submitBtn.click();
      return { ok: true, submitBtnFound: !!submitBtn, submitted: !!(autoSubmit && submitBtn) };
    },

    // Page /mon-compte/edit-account/ : remplit prénom/nom si vides, puis
    // enregistre.
    fillProfile(firstName, lastName, autoSave) {
      const firstInput = document.querySelector('#account_first_name, input[name="account_first_name"]');
      const lastInput = document.querySelector('#account_last_name, input[name="account_last_name"]');
      if (!firstInput || !lastInput) return { ok: false, reason: 'no-name-fields' };

      const alreadyFilled = !!(firstInput.value.trim() && lastInput.value.trim());
      if (!alreadyFilled) {
        if (!firstInput.value.trim()) setVal(firstInput, firstName);
        if (!lastInput.value.trim()) setVal(lastInput, lastName);
      }

      const saveBtn =
        document.querySelector('button[name="save_account_details"]') ||
        findByText('button, input[type="submit"]', ['enregistrer', 'save changes', 'save']);

      if (!alreadyFilled && autoSave && saveBtn) saveBtn.click();

      return {
        ok: true,
        alreadyFilled,
        saveBtnFound: !!saveBtn,
        saved: !alreadyFilled && !!(autoSave && saveBtn),
        currentFirst: firstInput.value,
        currentLast: lastInput.value,
      };
    },

    // Page produit : attend case + bouton, coche, clique, confirme.
    async participate() {
      let checkbox = await waitFor(findCheckbox, 12000);
      let btn = await waitFor(findParticipateButton, 12000);

      const item = productName();
      const image = productImage();

      if (!checkbox && !btn) {
        return { checkboxFound: false, buttonFound: false, checked: false, clicked: false, confirmed: false, item, image };
      }

      const checked = checkbox ? await ensureChecked(checkbox) : true;
      if (checkbox && !checked) {
        return { checkboxFound: true, buttonFound: !!btn, checked: false, clicked: false, confirmed: false, item, image };
      }
      if (!btn) {
        return { checkboxFound: !!checkbox, buttonFound: false, checked, clicked: false, confirmed: false, item, image };
      }

      await sleep(400);
      try {
        btn.scrollIntoView({ block: 'center' });
      } catch (_) {}
      btn.click();

      const confirmed = await waitFor(() => participationConfirmed() || null, 8000, 400);
      return { checkboxFound: !!checkbox, buttonFound: true, checked, clicked: true, confirmed: !!confirmed, item, image };
    },
  };
}
