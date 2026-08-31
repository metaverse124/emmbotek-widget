/**
 * Emmbotek - widget czatu asystenta eMMa Studio (Vanilla JS, bez zaleznosci).
 *
 * Zawiera: side tab "Zapytaj Emmbotka", okno 380x560 (fullscreen < 640 px),
 * animowany awatar Emmbotek, kontekstowe chipsy, Contextual CTA,
 * pamiec rozmowy w localStorage z informacja RODO, dostepnosc
 * (role="dialog", aria-live, focus trap, Esc) i lazy-init.
 *
 * Osadzenie:
 *   <link rel="stylesheet" href="/emma-widget.css">
 *   <script src="/emmbotek-avatar.js" defer></script>
 *   <script src="/emma-widget.js" defer></script>
 *   <script>window.addEventListener('DOMContentLoaded', function () { EmmaWidget.init(); });</script>
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var STORAGE_KEY = 'emma-ai-conversation-v1';
  // Zapamietujemy sam fakt otwarcia czatu, zeby zakladka nie pulsowala w nieskonczonosc.
  var KLUCZ_POZNANY = 'emmbotek-poznany-v1';
  // Zgoda na zasady korzystania z asystenta. Wersja w kluczu jest celowa: gdy zasady
  // sie zmienia, wystarczy podbic numer, zeby poprosic o zgode ponownie.
  var KLUCZ_ZGODY = 'emmbotek-zgoda-v1';
  var CONSENT_KEY = 'emma-ai-rodo-ack-v1';
  var MAX_CHARS = 600;

  var DEFAULTS = {
    apiUrl: '/api/chat',
    analyticsUrl: '/api/analytics',
    assetsBase: '/',
    tabLabel: 'Zapytaj Emmbotka',
    title: 'Emmbotek',
    status: 'Asystent eMMa Studio · odpowiada od razu',
    greeting: 'Dzień dobry! Jestem Emmbotek, asystent eMMa Studio. W czym mogę pomóc?',
    rodoNote: 'Ta rozmowa jest zapisywana lokalnie w Twojej przeglądarce, aby Emmbotek pamiętał jej kontekst.',
    privacyUrl: null,
    /** Adres zasad korzystania z asystenta. Domyslnie ta sama strona, co polityka. */
    rulesUrl: null,
    startChips: ['Kurs dla dziecka', 'Angielski dla mnie', 'Szkolenie dla firmy', 'Cennik', 'Lekcja próbna'],
    openOnLoad: false,
  };

  /** Kontekstowe chipsy zalezne od podstrony (sekcja 42 briefu). */
  var PAGE_CHIPS = [
    { match: /dzieci|dziecko/i, chips: ['Cennik', 'Dla jakiego wieku?', 'Lekcja próbna'] },
    { match: /firm|biznes|b2b/i, chips: ['Oferta dla firm', 'Jak to wygląda?', 'Zapytaj o szkolenie'] },
    { match: /aktualnosci|news/i, chips: ['Sprawdź szczegóły', 'Dla kogo jest grupa?', 'Jak się zapisać?'] },
    { match: /cennik|ceny/i, chips: ['Co wpływa na cenę?', 'Lekcja próbna', 'Zajęcia indywidualne'] },
    { match: /egzamin|fce|cae|ielts|toefl/i, chips: ['Ile trwa przygotowanie?', 'Test poziomujący', 'Cennik'] },
    { match: /blog|artykul/i, chips: ['Streszcz artykuł', 'Powiązane kursy', 'Mam pytanie językowe'] },
    { match: /doros/i, chips: ['Zajęcia po pracy', 'Test poziomujący', 'Cennik'] },
  ];

  var state = {
    options: null,
    open: false,
    busy: false,
    avatar: null,
    conversation: null,
    shownCtas: [],
    lastFocused: null,
    nodes: {},
    initialized: false,
  };

  /* ---------------------------------------------------------------- pamiec */

  function emptyConversation() {
    var now = new Date().toISOString();
    return {
      v: 1,
      sessionId: (global.crypto && global.crypto.randomUUID) ? global.crypto.randomUUID() : String(Date.now()),
      firstSeen: now,
      lastSeen: now,
      lead: { imie: null, email: null, telefon: null, zgoda: false },
      profil: { dlaKogo: null, jezyk: null, poziom: null, cel: null, tryb: null },
      messages: [],
    };
  }

  function loadConversation() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyConversation();
      var parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.messages)) return emptyConversation();
      return parsed;
    } catch (error) {
      return emptyConversation();
    }
  }

  function saveConversation() {
    try {
      state.conversation.lastSeen = new Date().toISOString();
      // trzymamy maksymalnie 40 ostatnich wiadomosci - reszta i tak nie trafia do modelu
      if (state.conversation.messages.length > 40) {
        state.conversation.messages = state.conversation.messages.slice(-40);
      }
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.conversation));
    } catch (error) { /* tryb prywatny / brak miejsca - widget dziala dalej bez pamieci */ }
  }

  function clearConversation() {
    try { global.localStorage.removeItem(STORAGE_KEY); } catch (error) { /* ignorujemy */ }
    state.conversation = emptyConversation();
    state.shownCtas = [];
    state.nodes.log.innerHTML = '';
    addMessage('model', state.options.greeting, { emotion: 'GREETING', save: false });
    renderChips(startChips());
    announce('Rozmowa została wyczyszczona.');
  }

  /* ------------------------------------------------------------------- DOM */

  function el(tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function build() {
    var root = el('div', 'emma');
    root.setAttribute('data-open', 'false');

    /* --- side tab --- */
    var tab = el('button', 'emma__tab');
    tab.type = 'button';
    tab.setAttribute('aria-haspopup', 'dialog');
    tab.setAttribute('aria-expanded', 'false');
    tab.setAttribute('aria-controls', 'emma-dialog');
    var tabAvatar = el('span', 'emma__tab-avatar emmbotek emmbotek--tab');
    tab.appendChild(tabAvatar);
    tab.appendChild(el('span', 'emma__tab-label', state.options.tabLabel));

    /* --- okno --- */
    var panel = el('div', 'emma__panel');
    panel.id = 'emma-dialog';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'emma-title');
    panel.hidden = true;

    var header = el('div', 'emma__header');
    var headAvatar = el('div', 'emma__avatar emmbotek emmbotek--header');
    var headText = el('div', 'emma__headtext');
    var title = el('p', 'emma__title', state.options.title);
    title.id = 'emma-title';
    var status = el('p', 'emma__status', state.options.status);
    headText.appendChild(title);
    headText.appendChild(status);

    var clearBtn = el('button', 'emma__icon-btn emma__icon-btn--kosz', '');
    clearBtn.type = 'button';
    clearBtn.title = 'Wyczyść rozmowę';
    clearBtn.setAttribute('aria-label', 'Wyczyść rozmowę');
    // Kosz: wieko z uchwytem, korpus i dwie kreski w srodku. Grubsza kreska (2)
    // i zaokraglone konce - przy 20 px cienka linia rozmywa sie na ekranach 1x.
    clearBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<path d="M4 7h16"/>'
      + '<path d="M9.5 7V5.4c0-.5.4-.9.9-.9h3.2c.5 0 .9.4.9.9V7"/>'
      + '<path d="M6.4 7.9l.8 10.3c.05.7.63 1.3 1.35 1.3h6.9c.72 0 1.3-.6 1.35-1.3l.8-10.3"/>'
      + '<path d="M10.3 11v5M13.7 11v5"/>'
      + '</svg>';

    var closeBtn = el('button', 'emma__icon-btn', '');
    closeBtn.type = 'button';
    closeBtn.title = 'Zamknij okno rozmowy';
    closeBtn.setAttribute('aria-label', 'Zamknij okno rozmowy');
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">'
      + '<path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/>'
      + '</svg>';

    header.appendChild(headAvatar);
    header.appendChild(headText);
    header.appendChild(clearBtn);
    header.appendChild(closeBtn);

    var log = el('div', 'emma__log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    log.setAttribute('aria-relevant', 'additions text');
    log.setAttribute('tabindex', '0');
    log.setAttribute('aria-label', 'Historia rozmowy z Emmbotkiem');

    var chips = el('div', 'emma__chips');
    chips.setAttribute('aria-label', 'Podpowiedzi');

    var form = el('form', 'emma__form');
    var field = el('label', 'emma__field');
    var input = el('textarea', 'emma__input');
    input.rows = 1;
    input.maxLength = MAX_CHARS;
    input.placeholder = 'Napisz wiadomość…';
    input.setAttribute('aria-label', 'Treść wiadomości do Emmbotka');
    var counter = el('span', 'emma__counter', '0/' + MAX_CHARS);
    counter.setAttribute('aria-hidden', 'true');
    var send = el('button', 'emma__send');
    send.type = 'submit';
    send.setAttribute('aria-label', 'Wyślij wiadomość');
    send.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.6 20.4 21 12 3.6 3.6 3.6 10.2 15 12 3.6 13.8z" fill="currentColor"/></svg>';
    field.appendChild(input);
    field.appendChild(counter);
    form.appendChild(field);
    form.appendChild(send);

    // Stopka informacyjna: sama tresc RODO i odnosnik do polityki prywatnosci.
    // "Wyczysc rozmowe" bylo tu drugi raz - ta sama czynnosc ma juz ikone kosza
    // w naglowku panelu, a dwa wejscia do jednej akcji w tak malym oknie tylko
    // rozpraszaly. Zostaje ikona, bo jest zawsze widoczna, takze przy dlugiej rozmowie.
    var note = el('p', 'emma__note');
    note.appendChild(doc.createTextNode(state.options.rodoNote));
    if (state.options.privacyUrl) {
      var privacy = el('a', 'emma__link', 'Polityka prywatności');
      privacy.href = state.options.privacyUrl;
      privacy.target = '_blank';
      privacy.rel = 'noopener';
      note.appendChild(doc.createTextNode(' '));
      note.appendChild(privacy);
    }

    /*
      Bramka zgody. Pokazuje sie nad polem wpisywania, dopoki uzytkownik nie potwierdzi,
      ze zna zasady korzystania z asystenta.

      Swiadomie NIE jest to zaznaczone z gory pole - zgoda ma byc czynnoscia, a nie
      przeoczeniem. Odnosnik do zasad otwiera sie w nowej karcie, zeby nie kasowac
      rozpoczetej rozmowy.
    */
    var zgoda = el('div', 'emma__zgoda');
    var zgodaId = 'emma-zgoda-' + Math.random().toString(36).slice(2, 8);
    var zgodaPole = doc.createElement('input');
    zgodaPole.type = 'checkbox';
    zgodaPole.className = 'emma__zgoda-pole';
    zgodaPole.id = zgodaId;

    var zgodaEtykieta = doc.createElement('label');
    zgodaEtykieta.className = 'emma__zgoda-tekst';
    zgodaEtykieta.setAttribute('for', zgodaId);
    zgodaEtykieta.appendChild(doc.createTextNode('Zapoznałem się z '));

    var zasady = el('a', 'emma__link', 'zasadami korzystania z asystenta');
    zasady.href = state.options.rulesUrl || state.options.privacyUrl || '#';
    zasady.target = '_blank';
    zasady.rel = 'noopener';
    zgodaEtykieta.appendChild(zasady);
    zgodaEtykieta.appendChild(doc.createTextNode(' i akceptuję je.'));

    zgoda.appendChild(zgodaPole);
    zgoda.appendChild(zgodaEtykieta);

    var live = el('p', 'emma__sr');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');

    panel.appendChild(header);
    panel.appendChild(log);
    panel.appendChild(chips);
    panel.appendChild(zgoda);
    panel.appendChild(form);
    panel.appendChild(note);
    panel.appendChild(live);

    root.appendChild(tab);
    root.appendChild(panel);
    doc.body.appendChild(root);

    state.nodes = {
      root: root, tab: tab, tabAvatar: tabAvatar, panel: panel, header: header,
      headAvatar: headAvatar, log: log, chips: chips, form: form, input: input,
      counter: counter, send: send, close: closeBtn, clear: clearBtn, live: live,
      zgoda: zgoda, zgodaPole: zgodaPole,
    };
  }

  /* -------------------------------------------------------------- rendering */

  function announce(text) {
    if (state.nodes.live) state.nodes.live.textContent = text;
  }

  /**
   * Przewija rozmowe do najnowszej wiadomosci.
   *
   * Dwie rzeczy, ktore latwo tu przeoczyc:
   *  - `behavior: auto` celowo, mimo `scroll-behavior: smooth` w stylach. Plynne
   *    przewijanie animuje do pozycji policzonej w chwili wywolania, a tresc rosnie
   *    jeszcze PO dopisaniu wiadomosci (przyciski CTA, zawijanie dlugiego tekstu).
   *    Animacja konczyla sie wtedy kilkadziesiat pikseli nad ostatnia odpowiedzia
   *    i uzytkownik musial doscrollowac reka.
   *  - powtorzenie w nastepnej klatce lapie wzrost wysokosci po przelicznieu ukladu.
   */
  function scrollLog() {
    var log = state.nodes.log;
    if (!log) return;
    var doDolu = function () {
      // Chwilowe wylaczenie plynnego przewijania inline. UWAGA: `behavior: 'auto'`
      // w scrollTo NIE znaczy "natychmiast" - znaczy "uzyj wartosci z CSS", a tam
      // stoi `scroll-behavior: smooth`. Nadpisanie stylem inline jest jedynym
      // sposobem, ktory dziala tez w starszych przegladarkach bez `behavior: 'instant'`.
      var poprzednie = log.style.scrollBehavior;
      log.style.scrollBehavior = 'auto';
      log.scrollTop = log.scrollHeight;
      log.style.scrollBehavior = poprzednie;
    };
    doDolu();
    if (typeof global.requestAnimationFrame === 'function') global.requestAnimationFrame(doDolu);
  }

  /** Minimalne formatowanie: akapity i lista punktowana. Zadnego HTML z modelu. */
  function renderText(container, text) {
    var lines = String(text).split(/\n+/);
    var list = null;
    lines.forEach(function (line) {
      var trimmed = line.trim();
      if (!trimmed) return;
      if (/^[-•*]\s+/.test(trimmed)) {
        if (!list) { list = el('ul', 'emma__list'); container.appendChild(list); }
        list.appendChild(el('li', null, trimmed.replace(/^[-•*]\s+/, '')));
      } else {
        list = null;
        container.appendChild(el('p', null, trimmed));
      }
    });
  }

  /**
   * Miniatura maskotki przy odpowiedzi - z mina tej konkretnej wypowiedzi.
   *
   * Awatar w naglowku pokazuje tylko emocje ostatniej odpowiedzi i po chwili wraca
   * do NEUTRAL. Przewijajac rozmowe w gore nie widac juz, z jakim nastawieniem
   * Emmbotek mowil wczesniej. Miniatura zostaje przy swojej wiadomosci na stale.
   *
   * Celowo statyczna klatka, nie animacja: przy dziesieciu odpowiedziach dziesiec
   * animacji naraz zjadaloby bateria i rozpraszalo od tresci.
   */
  function messageAvatar(emotion) {
    if (!state.avatar || !state.avatar.manifest) return null;
    var definition = state.avatar.definition(emotion) || state.avatar.definition('NEUTRAL');
    if (!definition || !definition.frames || !definition.frames.length) return null;

    var img = doc.createElement('img');
    img.className = 'emma__msg-avatar';
    img.src = state.avatar.frameUrl(definition.frames[0]);
    img.alt = '';                    // dekoracja - tresc niesie sama wiadomosc
    img.setAttribute('aria-hidden', 'true');
    img.loading = 'lazy';
    img.width = 44;
    img.height = 44;
    if (definition.label) img.title = 'Emmbotek: ' + definition.label;
    return img;
  }

  /**
   * Historia rozmowy jest odtwarzana zanim manifest emocji zdazy sie wczytac,
   * wiec te wiadomosci nie dostaly jeszcze miniatur. Uzupelniamy je, gdy manifest
   * juz jest - bez tego po odswiezeniu strony maskotka znikala z wczesniejszych odpowiedzi.
   */
  function uzupelnijMiniatury() {
    // bez selektora :has() - starsze przegladarki rzucaja na nim wyjatkiem,
    // a warunek nizej i tak odsiewa wiersze, ktore miniature juz maja
    var wiersze = state.nodes.log.querySelectorAll('.emma__row--emma');
    for (var i = 0; i < wiersze.length; i += 1) {
      var wiersz = wiersze[i];
      if (wiersz.querySelector('.emma__msg-avatar')) continue;
      var mini = messageAvatar(wiersz.getAttribute('data-emocja') || 'NEUTRAL');
      if (mini) wiersz.insertBefore(mini, wiersz.firstChild);
    }
  }

  function addMessage(role, text, options) {
    options = options || {};
    var row = el('div', 'emma__row emma__row--' + (role === 'user' ? 'user' : 'emma'));

    if (role !== 'user') {
      row.setAttribute('data-emocja', options.emotion || 'NEUTRAL');
      var mini = messageAvatar(options.emotion || 'NEUTRAL');
      if (mini) row.appendChild(mini);
    }

    var bubble = el('div', 'emma__bubble');
    renderText(bubble, text);
    row.appendChild(bubble);
    state.nodes.log.appendChild(row);
    scrollLog();

    if (options.save !== false) {
      state.conversation.messages.push({
        role: role === 'user' ? 'user' : 'model',
        text: text,
        intent: options.intent,
        // emocje zapisujemy, zeby po odtworzeniu rozmowy miny przy wiadomosciach
        // byly te same, a nie wszystkie neutralne
        emotion: options.emotion,
        at: new Date().toISOString(),
      });
      saveConversation();
    }
    return row;
  }

  function showTyping() {
    var row = el('div', 'emma__row emma__row--emma emma__row--typing');
    var bubble = el('div', 'emma__bubble emma__bubble--typing');
    bubble.setAttribute('aria-hidden', 'true');
    bubble.innerHTML = '<span></span><span></span><span></span>';
    row.appendChild(bubble);
    state.nodes.log.appendChild(row);
    scrollLog();
    announce('Emmbotek pisze odpowiedź.');
    return row;
  }

  /* -------------------------------------------------------------------- CTA */

  function trackCta(event, cta, extra) {
    if (!state.options.analyticsUrl) return;
    var payload = {
      event: event,
      ctaType: cta.type,
      sourceIntent: (extra && extra.intent) || 'GENERAL',
      conversationStage: (extra && extra.stage) || null,
      currentPage: global.location ? global.location.pathname : null,
    };
    try {
      var body = JSON.stringify({ events: [payload] });
      if (global.navigator && global.navigator.sendBeacon) {
        global.navigator.sendBeacon(state.options.analyticsUrl, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(state.options.analyticsUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true });
      }
    } catch (error) { /* telemetria nigdy nie psuje UX */ }
  }

  /**
   * Czy adres CTA wolno wstawic w href.
   *
   * Serwer juz to sprawdza - cel musi byc w mapie CTA zbudowanej przy indeksowaniu
   * albo byc znanym telefonem/mailem szkoly. To jest DRUGA warstwa, na wypadek gdyby
   * tamta kiedys przepuscila cos wiecej. Bez niej `javascript:` w odpowiedzi modelu
   * wykonalby sie po klknieciu w przycisk, ktory wyglada jak zwykly odnosnik.
   *
   * Dozwolone: adresy wzgledne (/oferta), https, tel: i mailto:. Nic wiecej -
   * w szczegolnosci zadnego javascript: i data:.
   */
  function bezpiecznyCel(adres) {
    var cel = String(adres || '').trim();
    if (!cel) return null;
    if (cel.charAt(0) === '/' && cel.charAt(1) !== '/') return cel;   // //host to juz obcy adres
    if (/^https:\/\//i.test(cel)) return cel;
    if (/^(tel:\+?[0-9\s-]{6,20}|mailto:[^\s<>"']{3,120})$/i.test(cel)) return cel;
    return null;
  }

  function renderCtas(row, ctas, meta) {
    if (!ctas || !ctas.length) return;
    var box = el('div', 'emma__ctas');
    ctas.slice(0, 2).forEach(function (cta, index) {
      var cel = bezpiecznyCel(cta.target);
      if (!cel) return;                 // przycisk bez wiarygodnego celu po prostu nie powstaje
      var button = el('a', 'emma__cta');
      button.href = cel;
      button.style.setProperty('--emma-cta-delay', (index * 90) + 'ms');
      if (/^https:/i.test(cel) && cel.indexOf(global.location.origin) !== 0) {
        button.target = '_blank';
        button.rel = 'noopener';
      }
      if (cta.icon) {
        var icon = el('span', 'emma__cta-icon', cta.icon);
        icon.setAttribute('aria-hidden', 'true');
        button.appendChild(icon);
      }
      button.appendChild(el('span', 'emma__cta-label', cta.label));
      button.addEventListener('click', function () { trackCta('cta_click', cta, meta); });
      box.appendChild(button);

      state.shownCtas.push(cta.type);
      trackCta('cta_impression', cta, meta);
    });
    row.appendChild(box);
    scrollLog();
  }

  /* ------------------------------------------------------------------ chipsy */

  function startChips() {
    var haystack = (global.location ? global.location.pathname : '') + ' ' + (doc.title || '');
    for (var i = 0; i < PAGE_CHIPS.length; i += 1) {
      if (PAGE_CHIPS[i].match.test(haystack)) return PAGE_CHIPS[i].chips;
    }
    return state.options.startChips;
  }

  function renderChips(list) {
    state.nodes.chips.innerHTML = '';
    if (!list || !list.length) return;
    list.forEach(function (label) {
      var chip = el('button', 'emma__chip', label);
      chip.type = 'button';
      // Chipsy tez wysylaja pytanie, wiec przed zgoda musza byc nieaktywne -
      // inaczej byloby wejscie do rozmowy z pominieciem bramki.
      chip.disabled = !czyZgoda();
      chip.addEventListener('click', function () {
        state.nodes.chips.innerHTML = '';
        send(label);
      });
      state.nodes.chips.appendChild(chip);
    });
  }

  /* ------------------------------------------------------------- komunikacja */

  function historyForApi() {
    return state.conversation.messages.slice(-24).map(function (message) {
      return { role: message.role, text: message.text, intent: message.intent, at: message.at };
    });
  }

  function pageType() {
    var body = doc.body;
    return (body && body.getAttribute('data-emma-page-type')) || null;
  }

  function send(text) {
    var message = String(text || '').trim().slice(0, MAX_CHARS);
    if (!message || state.busy) return;

    // Ostatnia linia obrony: nawet gdyby ktos ominal zablokowane pole (Enter,
    // konsola, chipsy), bez zgody rozmowa sie nie zaczyna.
    if (!czyZgoda()) {
      state.nodes.zgoda.hidden = false;
      state.nodes.zgoda.setAttribute('data-uwaga', 'true');
      global.setTimeout(function () { state.nodes.zgoda.removeAttribute('data-uwaga'); }, 1200);
      state.nodes.zgodaPole.focus();
      announce('Aby rozpocząć rozmowę, potwierdź zasady korzystania z asystenta.');
      return;
    }

    state.busy = true;
    state.nodes.send.disabled = true;
    state.nodes.chips.innerHTML = '';
    state.nodes.input.value = '';
    updateCounter();
    addMessage('user', message);
    if (state.avatar) { state.avatar.wake(); state.avatar.thinking(); }
    var typing = showTyping();

    fetch(state.options.apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: message,
        history: historyForApi(),
        currentUrl: global.location ? global.location.href : null,
        currentPageTitle: doc.title || null,
        pageType: pageType(),
        profile: state.conversation.profil,
        shownCtas: state.shownCtas.slice(-10),
      }),
    })
      .then(function (response) { return response.json().then(function (data) { return { status: response.status, data: data }; }); })
      .then(function (result) {
        typing.remove();
        var data = result.data || {};
        if (result.status >= 400 && !data.message) {
          throw new Error(data.error || 'Blad polaczenia');
        }
        if (data.profile) state.conversation.profil = data.profile;

        var emotion = data.emotion || 'NEUTRAL';
        if (state.avatar) state.avatar.set(emotion);

        var row = addMessage('model', data.message, {
          emotion: emotion,
          intent: data.meta && data.meta.intent,
        });
        renderCtas(row, data.cta, { intent: data.meta && data.meta.intent, stage: data.stage });
        announce(data.message);
        saveConversation();
      })
      .catch(function () {
        typing.remove();
        if (state.avatar) state.avatar.set('EMPATHY');
        addMessage('model', 'Chwilowo nie mogę się połączyć. Proszę spróbować za moment albo napisać do sekretariatu.', { save: false });
      })
      .then(function () {
        state.busy = false;
        state.nodes.send.disabled = false;
        if (state.open) state.nodes.input.focus();
      });
  }

  /* -------------------------------------------------------------- dostepnosc */

  function focusables() {
    return Array.prototype.slice.call(
      state.nodes.panel.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'),
    ).filter(function (node) { return node.offsetParent !== null || node === doc.activeElement; });
  }

  function onKeydown(event) {
    if (!state.open) return;
    if (event.key === 'Escape') { event.stopPropagation(); close(); return; }
    if (event.key !== 'Tab') return;

    // focus trap dziala tylko w trybie fullscreen (mobile), gdzie okno przykrywa strone
    if (!global.matchMedia('(max-width: 640px)').matches) return;
    var list = focusables();
    if (!list.length) return;
    var first = list[0];
    var last = list[list.length - 1];
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  /* ------------------------------------------------------------ otwarcie/zamk */

  /** Czy uzytkownik juz kiedys otworzyl czat (wtedy zakladka nie pulsuje). */
  function czyPoznany() {
    try { return global.localStorage.getItem(KLUCZ_POZNANY) === '1'; }
    catch (error) { return false; }   // tryb prywatny albo zablokowana pamiec
  }

  function zapamietajPoznanie() {
    state.nodes.root.setAttribute('data-poznany', 'true');
    try { global.localStorage.setItem(KLUCZ_POZNANY, '1'); } catch (error) { /* ignorujemy */ }
  }

  /* ------------------------------------------------------------------ zgoda */

  function czyZgoda() {
    try { return global.localStorage.getItem(KLUCZ_ZGODY) === '1'; }
    catch (error) { return false; }
  }

  /**
   * Blokuje rozmowe do czasu potwierdzenia zasad.
   *
   * Blokujemy pole i przycisk, a nie tylko chowamy bramke - inaczej wystarczyloby
   * wcisnac Enter, zeby wyslac wiadomosc mimo braku zgody. Chipsy tez sa wylaczone,
   * bo one rowniez wysylaja pytanie.
   */
  function odswiezZgode() {
    var zgodzil = czyZgoda();
    state.zgoda = zgodzil;
    state.nodes.zgoda.hidden = zgodzil;
    state.nodes.input.disabled = !zgodzil;
    state.nodes.send.disabled = !zgodzil || state.busy;
    state.nodes.input.placeholder = zgodzil
      ? 'Napisz wiadomość…'
      : 'Najpierw potwierdź zasady powyżej';
    state.nodes.chips.setAttribute('data-zablokowane', zgodzil ? 'false' : 'true');
    var chipsy = state.nodes.chips.querySelectorAll('button');
    for (var i = 0; i < chipsy.length; i += 1) chipsy[i].disabled = !zgodzil;
  }

  function zapiszZgode(zgodzil) {
    try {
      if (zgodzil) global.localStorage.setItem(KLUCZ_ZGODY, '1');
      else global.localStorage.removeItem(KLUCZ_ZGODY);
    } catch (error) { /* tryb prywatny - zgoda obowiazuje do konca sesji */ }
    odswiezZgode();
    if (zgodzil) {
      announce('Zasady potwierdzone. Można pisać.');
      state.nodes.input.focus();
    }
  }

  function open() {
    if (state.open) return;
    state.open = true;
    state.lastFocused = doc.activeElement;
    state.nodes.panel.hidden = false;
    state.nodes.root.setAttribute('data-open', 'true');
    state.nodes.tab.setAttribute('aria-expanded', 'true');
    if (global.matchMedia('(max-width: 640px)').matches) {
      state.nodes.panel.setAttribute('aria-modal', 'true');
      doc.documentElement.classList.add('emma-locked');
    }

    if (!state.conversation.messages.length) {
      addMessage('model', state.options.greeting, { emotion: 'GREETING', save: false });
      if (state.avatar) state.avatar.set('GREETING');
      renderChips(startChips());
    } else if (state.avatar) {
      state.avatar.set('SMILE');
    }
    if (state.avatar) state.avatar.preloadAll();

    // Rozmowa jest odtwarzana z localStorage, gdy panel jest jeszcze ukryty. Ukryty
    // element ma zerowa wysokosc, wiec przewijanie przy dopisywaniu wiadomosci nie mialo
    // czego przewijac - po otwarciu uzytkownik ogladal POCZATEK rozmowy zamiast ostatniej
    // odpowiedzi. Przewijamy wiec jeszcze raz, gdy panel ma juz swoje wymiary.
    scrollLog();

    // Zaproszenie spelnilo swoje zadanie - zakladka przestaje pulsowac na stale.
    zapamietajPoznanie();

    global.setTimeout(function () { state.nodes.input.focus(); }, 60);
    announce('Okno rozmowy z Emmbotkiem jest otwarte.');
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    state.nodes.panel.hidden = true;
    state.nodes.panel.setAttribute('aria-modal', 'false');
    state.nodes.root.setAttribute('data-open', 'false');
    state.nodes.tab.setAttribute('aria-expanded', 'false');
    doc.documentElement.classList.remove('emma-locked');
    if (state.lastFocused && state.lastFocused.focus) state.lastFocused.focus();
    else state.nodes.tab.focus();
  }

  function updateCounter() {
    var wartosc = state.nodes.input.value;
    var length = wartosc.length;
    state.nodes.counter.textContent = length + '/' + MAX_CHARS;
    // Licznik ma sens dopiero, gdy zaczyna byc ciasno. Przy pustym polu "0/600"
    // niczego nie wnosilo, a zabieralo miejsce tekstowi.
    state.nodes.counter.setAttribute('data-widoczny', length > MAX_CHARS * 0.7 ? 'true' : 'false');
    state.nodes.counter.setAttribute('data-warn', length > MAX_CHARS - 60 ? 'true' : 'false');
    state.nodes.send.setAttribute('data-pusty', wartosc.trim() ? 'false' : 'true');
    state.nodes.input.style.height = 'auto';
    state.nodes.input.style.height = Math.min(120, state.nodes.input.scrollHeight) + 'px';
  }

  /* -------------------------------------------------------------------- init */

  function restoreHistory() {
    state.conversation.messages.forEach(function (message) {
      addMessage(message.role === 'user' ? 'user' : 'model', message.text, {
        save: false,
        emotion: message.emotion,
      });
    });
  }

  function init(options) {
    if (state.initialized) return;
    state.initialized = true;
    state.options = Object.assign({}, DEFAULTS, options || {});
    state.conversation = loadConversation();

    build();
    restoreHistory();
    // Kto juz raz rozmawial, nie potrzebuje zaproszenia - zakladka nie pulsuje.
    if (czyPoznany()) state.nodes.root.setAttribute('data-poznany', 'true');
    state.nodes.zgodaPole.checked = czyZgoda();
    odswiezZgode();
    updateCounter();

    if (global.EmmbotekAvatar) {
      state.avatar = new global.EmmbotekAvatar({
        element: state.nodes.headAvatar,
        basePath: state.options.assetsBase + 'avatars/',
      });
      state.avatar.load().then(function () {
        uzupelnijMiniatury();
        // ta sama maskotka na side tabie - druga, lekka instancja tylko z poza NEUTRAL
        var tabAvatar = new global.EmmbotekAvatar({
          element: state.nodes.tabAvatar,
          basePath: state.options.assetsBase + 'avatars/',
          idleAfterMs: 0,
        });
        state.tabAvatar = tabAvatar;
        tabAvatar.load();
      });
    }

    state.nodes.tab.addEventListener('click', function () { state.open ? close() : open(); });
    state.nodes.close.addEventListener('click', close);
    state.nodes.clear.addEventListener('click', clearConversation);
    state.nodes.form.addEventListener('submit', function (event) {
      event.preventDefault();
      send(state.nodes.input.value);
    });
    state.nodes.zgodaPole.addEventListener('change', function (event) {
      zapiszZgode(event.target.checked);
    });
    state.nodes.input.addEventListener('input', updateCounter);
    state.nodes.input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send(state.nodes.input.value);
      }
    });
    doc.addEventListener('keydown', onKeydown);

    if (state.options.openOnLoad) open();
  }

  global.EmmaWidget = {
    init: init,
    open: open,
    close: close,
    send: send,
    clear: clearConversation,
    get state() { return state; },
  };
}(typeof window !== 'undefined' ? window : this));
