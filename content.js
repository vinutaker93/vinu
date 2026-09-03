(function () {
  'use strict';

  const IS_TOP = window.top === window;
  const SITE = 'pokelite.fr';

  // --- Helpers DOM (traverse aussi les shadow roots) ----------------------
  function collectRoots(root = document, acc = []) {
    acc.push(root);
    const walker = root.querySelectorAll ? root.querySelectorAll('*') : [];
    walker.forEach((el) => {
      if (el.shadowRoot) collectRoots(el.shadowRoot, acc);
    });
    return acc;
  }

  function $$(sel, root = document) {
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
      el.getAttribute && (el.getAttribute('data-text') || ''),
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

  function findByText(selectors, fragments, root = document) {
    const frags = fragments.map((f) => f.toLowerCase());
    const els = $$(selectors, root);
    // Priorité aux éléments visibles et au texte le plus court (le plus précis).
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

  function waitFor(fn, { timeout = 15000, interval = 250 } = {}) {
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

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // --- Messages -----------------------------------------------------------
  function report(payload) {
    try {
      chrome.runtime.sendMessage(
        { type: 'NOTIFY_DISCORD', payload: Object.assign({ site: SITE, url: location.href }, payload) },
        () => void chrome.runtime.lastError
      );
    } catch (_) {}
  }

  function send(type, extra = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(Object.assign({ type }, extra), (res) => {
          void chrome.runtime.lastError;
          resolve(res);
        });
      } catch (_) {
        resolve(null);
      }
    });
  }

  const store = {
    get: (keys) => new Promise((r) => chrome.storage.local.get(keys, r)),
    set: (obj) => new Promise((r) => chrome.storage.local.set(obj, r)),
  };

  function normalizeUrl(u) {
    return u.split('#')[0].split('?')[0];
  }

  function isLoggedIn() {
    return (
      !!document.querySelector('.woocommerce-MyAccount-navigation, a[href*="customer-logout"]') ||
      !!findByText('a', ['déconnexion', 'deconnexion', 'logout', 'log out'])
    );
  }

  function productName() {
    const el =
      document.querySelector('h1.product_title, .product_title, h1.entry-title, h1') || null;
    return (el && el.textContent.trim()) || document.title.split('–')[0].trim() || '—';
  }

  function productImage() {
    const img =
      document.querySelector('.woocommerce-product-gallery__image img, .wp-post-image, meta[property="og:image"]');
    if (!img) return null;
    return img.tagName === 'META' ? img.getAttribute('content') : img.currentSrc || img.src;
  }

  // --- Noms français ------------------------------------------------------
  const FRENCH_FIRST_NAMES = [
    'Lucas', 'Emma', 'Louis', 'Léa', 'Hugo', 'Manon', 'Nathan', 'Chloé', 'Enzo', 'Camille',
    'Gabriel', 'Sarah', 'Raphaël', 'Inès', 'Jules', 'Louise', 'Adam', 'Jade', 'Arthur', 'Alice',
    'Maxime', 'Julie', 'Thomas', 'Clara', 'Antoine', 'Marie', 'Nicolas', 'Laura', 'Julien', 'Charlotte',
  ];
  const FRENCH_LAST_NAMES = [
    'Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau',
    'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier',
    'Morel', 'Girard', 'André', 'Lefèvre', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'François', 'Rousseau',
  ];

  function randomFrenchName() {
    return {
      firstName: FRENCH_FIRST_NAMES[Math.floor(Math.random() * FRENCH_FIRST_NAMES.length)],
      lastName: FRENCH_LAST_NAMES[Math.floor(Math.random() * FRENCH_LAST_NAMES.length)],
    };
  }

  function setVal(input, val) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;
    input.focus();
    setter.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // --- Détection de la case à cocher --------------------------------------
  // Beaucoup de pages produit utilisent une case masquée (opacity:0 / clip)
  // stylée par un <label> ou un <span>. Cliquer l'input n'a alors aucun effet :
  // il faut cliquer l'élément visible associé, puis vérifier l'état réel.
  const CHECKBOX_HINTS = [
    'particip',
    'je participe',
    'tirage',
    'conditions',
    'règlement',
    'reglement',
    'accepte',
    'j’accepte',
    "j'accepte",
    'consens',
    'inscription au tirage',
  ];

  function labelTextFor(cb) {
    const bits = [];
    if (cb.id) {
      $$(`label[for="${CSS.escape(cb.id)}"]`).forEach((l) => bits.push(l.textContent || ''));
    }
    const parentLabel = cb.closest('label');
    if (parentLabel) bits.push(parentLabel.textContent || '');
    const wrapper = cb.closest('.form-row, .checkbox, li, p, div');
    if (wrapper) bits.push(wrapper.textContent || '');
    bits.push(cb.name || '', cb.id || '', cb.getAttribute('aria-label') || '');
    return bits.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function findCheckbox() {
    // On garde aussi les cases masquées (opacity:0, clip) : sur Pokelite la
    // vraie case est souvent invisible et pilotée par un label stylé.
    const boxes = $$('input[type="checkbox"]').filter((cb) => !cb.disabled);
    if (boxes.length === 0) return findCustomCheckbox();

    // 1. case dont le libellé parle de participation / conditions
    const scored = boxes
      .map((cb) => {
        const t = labelTextFor(cb);
        const hit = CHECKBOX_HINTS.findIndex((h) => t.includes(h));
        return { cb, score: hit === -1 ? 99 : hit };
      })
      .sort((a, b) => a.score - b.score);

    if (scored[0] && scored[0].score < 99) return scored[0].cb;

    // 2. case située dans le même formulaire que le bouton « Je participe »
    const btn = findParticipateButton();
    if (btn) {
      const form = btn.closest('form, .elementor-widget-container, section, div');
      if (form) {
        const inForm = boxes.find((cb) => form.contains(cb));
        if (inForm) return inForm;
      }
    }

    // 3. fallback : première case non cochée
    return boxes.find((cb) => !cb.checked) || boxes[0] || findCustomCheckbox();
  }

  // Cases « maison » (div/span avec role=checkbox ou classes usuelles)
  function findCustomCheckbox() {
    const sel =
      '[role="checkbox"], .checkbox-custom, .custom-checkbox, .wpcf7-list-item-label, .checkmark';
    const els = $$(sel).filter(isVisible);
    const hinted = els.find((el) => {
      const t = textOf(el.closest('label, div, li, p') || el);
      return CHECKBOX_HINTS.some((h) => t.includes(h));
    });
    return hinted || els[0] || null;
  }

  function isChecked(cb) {
    if (!cb) return false;
    if (typeof cb.checked === 'boolean' && cb.type === 'checkbox') return cb.checked;
    return cb.getAttribute('aria-checked') === 'true' || cb.classList.contains('checked');
  }

  // Coche la case de façon fiable : clic natif, sinon clic sur le libellé
  // visible, sinon forçage de la propriété + événements.
  async function ensureChecked(cb) {
    if (!cb) return false;
    if (isChecked(cb)) return true;

    const attempts = [];

    attempts.push(() => cb.click());

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

  // --- Bouton « Je participe » -------------------------------------------
  const PARTICIPATE_HINTS = [
    'je participe',
    'participer au tirage',
    'participer',
    'participate',
    'valider ma participation',
    'je tente ma chance',
    'tenter ma chance',
    's’inscrire au tirage',
    "s'inscrire au tirage",
  ];

  function findParticipateButton() {
    const direct = findByText(
      'button, input[type="submit"], input[type="button"], a, [role="button"], .button, .elementor-button',
      PARTICIPATE_HINTS
    );
    if (direct) return direct;

    // Fallback WooCommerce : bouton d'ajout au panier du formulaire du tirage
    const cart = document.querySelector('button[name="add-to-cart"], .single_add_to_cart_button');
    return cart || null;
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

  // --- 1. Page compte -----------------------------------------------------
  async function handleAccountPage(myEmail) {
    if (isLoggedIn()) {
      const { filledProfiles = {}, raffleOpenedByEmail = {}, profileNames = {} } = await store.get([
        'filledProfiles',
        'raffleOpenedByEmail',
        'profileNames',
      ]);

      if (!filledProfiles[myEmail]) {
        panel('Compte connecté ✅', ['Renseignement automatique du prénom / nom...']);
        setTimeout(() => {
          location.href = 'https://www.pokelite.fr/mon-compte/edit-account/';
        }, 500);
        return;
      }

      if (raffleOpenedByEmail[myEmail]) {
        panel('Compte prêt ✅', ['Les 7 liens du tirage ont déjà été ouverts pour ce compte.'], [
          {
            label: 'Ré-ouvrir les 7 liens du tirage',
            onClick: () => send('OPEN_RAFFLE_LINKS', { email: myEmail }),
          },
        ]);
      } else {
        const n = profileNames[myEmail];
        panel('Compte prêt ✅', ['Ouverture automatique des 7 liens du tirage...']);
        report({
          status: 'success',
          title: '🆕 Compte prêt',
          step: 'Création de compte',
          email: myEmail,
          item: 'Compte Pokelite',
          profileName: n ? `${n.firstName} ${n.lastName}` : '—',
          description: 'Compte créé et profil (prénom/nom) enregistré. Ouverture des 7 liens du tirage.',
        });
        send('ACCOUNT_READY', { email: myEmail });
      }
      return;
    }

    // Pas connecté : pré-remplissage du formulaire d'inscription
    const emailInputs = $$('input[type="email"], input[name*="email" i]').filter(isVisible);
    if (emailInputs.length === 0) return;

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

    if (target.value !== myEmail) setVal(target, myEmail);

    const form = target.closest('form');
    const submitBtn =
      findByText('button, input[type="submit"]', ['inscri', 'sign up', "s'inscrire"], form || document) ||
      (form && form.querySelector('button[type="submit"], input[type="submit"]'));

    panel(
      'Inscription',
      [
        `Email importé : ${myEmail}`,
        submitBtn ? "Bouton d'inscription trouvé." : "Bouton d'inscription introuvable — clique-le toi-même.",
      ],
      submitBtn
        ? [
            {
              label: "S'inscrire",
              onClick: () => {
                submitBtn.click();
                report({
                  status: 'info',
                  title: '📝 Inscription envoyée',
                  step: 'Inscription',
                  email: myEmail,
                  item: 'Création de compte Pokelite',
                });
              },
            },
          ]
        : []
    );
  }

  // --- 1b. Prénom / nom ---------------------------------------------------
  async function handleEditAccountPage(myEmail) {
    const firstInput = await waitFor(
      () => document.querySelector('#account_first_name, input[name="account_first_name"]'),
      { timeout: 8000 }
    );
    const lastInput = document.querySelector('#account_last_name, input[name="account_last_name"]');
    if (!firstInput || !lastInput) return;

    const { profileNames = {}, filledProfiles = {}, raffleOpenedByEmail = {} } = await store.get([
      'profileNames',
      'filledProfiles',
      'raffleOpenedByEmail',
    ]);

    // Déjà fait : on enchaîne directement sur l'ouverture des 7 liens.
    if (filledProfiles[myEmail] && firstInput.value.trim() && lastInput.value.trim()) {
      panel('Profil', [`Prénom / nom déjà renseignés (${firstInput.value} ${lastInput.value}).`]);
      if (!raffleOpenedByEmail[myEmail]) {
        report({
          status: 'success',
          title: '🆕 Compte prêt',
          step: 'Profil enregistré',
          email: myEmail,
          item: 'Compte Pokelite',
          profileName: `${firstInput.value} ${lastInput.value}`,
          description: 'Prénom et nom enregistrés. Ouverture automatique des 7 liens du tirage.',
        });
        await send('ACCOUNT_READY', { email: myEmail });
      }
      return;
    }

    let name = profileNames[myEmail];
    if (!name) {
      name = randomFrenchName();
      profileNames[myEmail] = name;
    }

    if (!firstInput.value.trim()) setVal(firstInput, name.firstName);
    if (!lastInput.value.trim()) setVal(lastInput, name.lastName);

    const saveBtn =
      document.querySelector('button[name="save_account_details"]') ||
      findByText('button, input[type="submit"]', ['enregistrer', 'save changes', 'save']);

    filledProfiles[myEmail] = true;
    await store.set({ profileNames, filledProfiles });

    panel('Profil', [
      `Prénom : ${name.firstName}`,
      `Nom : ${name.lastName}`,
      saveBtn ? 'Enregistrement automatique...' : 'Bouton « Enregistrer » introuvable — clique-le toi-même.',
    ]);

    if (saveBtn) {
      await sleep(400);
      saveBtn.click();

      // Après la sauvegarde WooCommerce recharge la page : on attend la
      // confirmation puis on déclenche l'ouverture des 7 liens SANS clic manuel.
      const confirmed = await waitFor(
        () =>
          document.querySelector('.woocommerce-message') ||
          (document.querySelector('#account_first_name') &&
            document.querySelector('#account_first_name').value.trim()),
        { timeout: 12000 }
      );

      report({
        status: 'success',
        title: '👤 Profil enregistré',
        step: 'Prénom / nom',
        email: myEmail,
        item: 'Compte Pokelite',
        profileName: `${name.firstName} ${name.lastName}`,
        description: confirmed
          ? 'Prénom et nom enregistrés. Ouverture automatique des 7 liens du tirage.'
          : 'Prénom et nom soumis (confirmation non détectée). Ouverture des 7 liens du tirage.',
      });

      await send('ACCOUNT_READY', { email: myEmail });
    }
  }

  // --- Debug : capture du HTML du bloc de participation -------------------
  // Sert à m'envoyer le HTML exact quand la case ou le bouton ne sont pas
  // détectés, pour ajouter le bon sélecteur.
  function captureBlockHtml(checkbox, btn) {
    const anchor = checkbox || btn;
    let block = null;

    if (anchor) {
      // On remonte jusqu'au conteneur qui englobe la case ET le bouton.
      let el = anchor;
      while (el && el !== document.body) {
        if ((!checkbox || el.contains(checkbox)) && (!btn || el.contains(btn))) {
          if (el.matches('form, .product, .summary, section, article') || el.children.length > 1) {
            block = el;
            break;
          }
        }
        el = el.parentElement;
      }
    }

    block =
      block ||
      document.querySelector('form.cart, form, .summary.entry-summary, .product, main') ||
      document.body;

    const html = block.outerHTML;
    return [
      `URL: ${location.href}`,
      `Titre: ${document.title}`,
      `Case détectée: ${checkbox ? describe(checkbox) : 'AUCUNE'}`,
      `Bouton détecté: ${btn ? describe(btn) : 'AUCUN'}`,
      `Cases présentes: ${$$('input[type="checkbox"]').map(describe).join(' | ') || 'aucune'}`,
      `Boutons présents: ${$$('button, input[type="submit"], .button')
        .slice(0, 15)
        .map((b) => `${describe(b)} "${textOf(b).slice(0, 40)}"`)
        .join(' | ')}`,
      '--- HTML DU BLOC ---',
      html.length > 60000 ? html.slice(0, 60000) + '\n[...tronqué...]' : html,
    ].join('\n');
  }

  function describe(el) {
    if (!el) return '—';
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.')
      : '';
    const name = el.name ? `[name="${el.name}"]` : '';
    return `${el.tagName.toLowerCase()}${id}${cls}${name}`;
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {}
    // Repli si l'API clipboard est bloquée par la page.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_) {}
    ta.remove();
    return ok;
  }

  // --- 2. Catégorie -------------------------------------------------------
  function handleCategoryPage() {
    const hrefs = Array.from(
      new Set(
        $$('a')
          .filter((a) => /\/produit\//.test(a.getAttribute('href') || ''))
          .map((a) => a.href)
      )
    );
    if (hrefs.length === 0) return;

    panel(
      `Produits sur cette page (${hrefs.length})`,
      ['Ouvre un produit : la case et « Je participe » sont automatiques.'],
      hrefs.map((href, i) => ({
        label: `Ouvrir le produit ${i + 1}`,
        onClick: () => window.open(href, '_blank'),
      }))
    );
  }

  // --- 3. Page produit : coche + participe --------------------------------
  async function handleProductPage(myEmail) {
    const url = normalizeUrl(location.href);
    const item = productName();

    const { doneByEmail = {} } = await store.get(['doneByEmail']);
    const doneUrls = doneByEmail[myEmail] || {};
    const alreadyDone = !!doneUrls[url];

    async function markDone(state) {
      const fresh = (await store.get(['doneByEmail'])).doneByEmail || {};
      fresh[myEmail] = fresh[myEmail] || {};
      fresh[myEmail][url] = { at: Date.now(), state };
      await store.set({ doneByEmail: fresh });
    }

    async function progressLine() {
      const fresh = (await store.get(['doneByEmail'])).doneByEmail || {};
      const n = Object.keys(fresh[myEmail] || {}).length;
      return `${n}/7 tirages traités pour ce compte`;
    }

    // La case et le bouton apparaissent parfois après le chargement (JS du
    // thème, lazy-load) : on les attend au lieu d'abandonner immédiatement.
    let checkbox = await waitFor(findCheckbox, { timeout: 12000 });
    let btn = await waitFor(findParticipateButton, { timeout: 12000 });

    // Observe aussi les insertions tardives dans le DOM.
    if (!checkbox || !btn) {
      const found = await new Promise((resolve) => {
        const obs = new MutationObserver(() => {
          const c = findCheckbox();
          const b = findParticipateButton();
          if (c && b) {
            obs.disconnect();
            resolve({ c, b });
          }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => {
          obs.disconnect();
          resolve(null);
        }, 8000);
      });
      if (found) {
        checkbox = found.c;
        btn = found.b;
      }
    }

    function refreshPanel(extra) {
      panel(
        'Participation',
        [
          `Item : ${item}`,
          checkbox ? '☑️ Case trouvée.' : '⚠️ Aucune case trouvée.',
          btn ? '🟡 Bouton « Je participe » trouvé.' : '⚠️ Bouton « Je participe » introuvable.',
          alreadyDone ? 'Déjà fait sur cette page.' : extra || 'Participation automatique en cours...',
        ],
        [
          {
            label: 'Refaire (cocher + participer)',
            onClick: () => autoParticipate(true),
          },
          {
            label: '📋 Copier le HTML du bloc',
            onClick: async () => {
              const dump = captureBlockHtml(checkbox, btn);
              console.log('[Pokelite Helper] Bloc de participation :\n' + dump);
              const ok = await copyToClipboard(dump);
              refreshPanel(
                ok
                  ? '📋 HTML copié — colle-le dans le chat.'
                  : '📋 Copie bloquée — le HTML est dans la console (F12).'
              );
            },
          },
        ]
      );
    }

    async function autoParticipate(manual = false) {
      const checkedOk = checkbox ? await ensureChecked(checkbox) : true;

      if (checkbox && !checkedOk) {
        refreshPanel('❌ Impossible de cocher la case.');
        report({
          status: 'error',
          title: '❌ Case à cocher impossible',
          step: 'Cochage',
          email: myEmail,
          item,
          image: productImage(),
          detail: 'La case a été trouvée mais son état n’a pas pu être modifié.',
          progress: await progressLine(),
        });
        return;
      }

      if (!btn) {
        refreshPanel('❌ Bouton « Je participe » introuvable.');
        report({
          status: 'error',
          title: '❌ Bouton « Je participe » introuvable',
          step: 'Participation',
          email: myEmail,
          item,
          image: productImage(),
          progress: await progressLine(),
        });
        return;
      }

      await sleep(500);
      try {
        btn.scrollIntoView({ block: 'center' });
      } catch (_) {}
      btn.click();

      const confirmed = await waitFor(participationConfirmed, { timeout: 8000, interval: 400 });
      await markDone(confirmed ? 'success' : 'submitted');

      refreshPanel(confirmed ? '✅ Participation confirmée.' : '📨 Participation envoyée.');
      report({
        status: confirmed ? 'success' : 'warning',
        title: confirmed ? '🎉 Participation enregistrée' : '📨 Participation envoyée (non confirmée)',
        step: manual ? 'Participation (manuelle)' : 'Participation (auto)',
        email: myEmail,
        item,
        image: productImage(),
        description: confirmed
          ? 'La case a été cochée et « Je participe » validé. Confirmation détectée sur la page.'
          : 'La case a été cochée et « Je participe » cliqué, mais aucun message de confirmation n’a été détecté.',
        progress: await progressLine(),
      });
    }

    refreshPanel();

    if (!alreadyDone && btn) {
      await sleep(700);
      autoParticipate();
    } else if (!alreadyDone && !btn) {
      report({
        status: 'error',
        title: '❌ Page de tirage non reconnue',
        step: 'Détection',
        email: myEmail,
        item,
        image: productImage(),
        detail: 'Ni la case ni le bouton « Je participe » n’ont été détectés sur cette page.',
        progress: await progressLine(),
      });
    }
  }

  // --- Panneau ------------------------------------------------------------
  function panel(title, lines, buttons = []) {
    if (!IS_TOP) return;
    const existing = document.getElementById('pokelite-helper-panel');
    if (existing) existing.remove();

    const box = document.createElement('div');
    box.id = 'pokelite-helper-panel';
    box.style.cssText =
      'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#222;color:#fff;' +
      'padding:12px 14px;border-radius:8px;font:13px/1.4 sans-serif;max-width:300px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.4)';
    const h = document.createElement('div');
    h.textContent = title;
    h.style.cssText = 'font-weight:bold;margin-bottom:6px';
    box.appendChild(h);
    lines.forEach((l) => {
      const p = document.createElement('div');
      p.textContent = l;
      p.style.cssText = 'opacity:.85;margin-bottom:4px';
      box.appendChild(p);
    });
    buttons.filter(Boolean).forEach((b) => {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      btn.style.cssText =
        'display:block;width:100%;margin-top:6px;padding:6px 8px;border:none;' +
        'border-radius:4px;background:#f2c200;color:#000;font-weight:bold;cursor:pointer';
      btn.onclick = b.onClick;
      box.appendChild(btn);
    });
    (document.body || document.documentElement).appendChild(box);
  }

  // --- Routage ------------------------------------------------------------
  (async function main() {
    const { myEmail } = await store.get(['myEmail']);
    const email = myEmail || 'CHANGE_ME@example.com';
    const path = location.pathname;

    if (path.includes('/mon-compte/edit-account')) {
      if (IS_TOP) handleEditAccountPage(email);
    } else if (path.includes('/mon-compte')) {
      if (IS_TOP) handleAccountPage(email);
    } else if (path.includes('/product-category/')) {
      if (IS_TOP) handleCategoryPage();
    } else if (path.includes('/produit/')) {
      handleProductPage(email);
    }
  })();
})();
