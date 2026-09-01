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

  /**
   * Jezyki rozmowy - te same, ktorych uczy szkola. Lista jest tu powtorzona swiadomie:
   * widget musi narysowac przelacznik zanim wykona jakiekolwiek zapytanie do serwera.
   * Serwer i tak sprawdza kod jezyka u siebie, wiec podmiana tej listy w przegladarce
   * niczego nie daje.
   */
  var JEZYKI = [
    { kod: 'pl', wlasna: 'Polski', flaga: '🇵🇱' },
    { kod: 'en', wlasna: 'English', flaga: '🇬🇧' },
    { kod: 'es', wlasna: 'Español', flaga: '🇪🇸' },
    { kod: 'de', wlasna: 'Deutsch', flaga: '🇩🇪' },
    { kod: 'fr', wlasna: 'Français', flaga: '🇫🇷' },
    { kod: 'it', wlasna: 'Italiano', flaga: '🇮🇹' },
    { kod: 'ru', wlasna: 'Русский', flaga: '🇷🇺' },
    { kod: 'uk', wlasna: 'Українська', flaga: '🇺🇦' },
    { kod: 'ko', wlasna: '한국어', flaga: '🇰🇷' },
  ];

  /**
   * Skala oceny rozmowy - miny maskotki zamiast gwiazdek.
   *
   * Emmbotek ma juz czternascie stanow emocjonalnych; uzycie ich do oceny jest
   * spojne z reszta i czytelne bez tlumaczenia w kazdym jezyku.
   */
  var OCENY = [
    { stopien: 1, emocja: 'SAD', opis: 'Wcale mi nie pomógł' },
    { stopien: 2, emocja: 'CURIOUS', opis: 'Pomógł połowicznie' },
    { stopien: 3, emocja: 'NEUTRAL', opis: 'W porządku' },
    { stopien: 4, emocja: 'SMILE', opis: 'Pomógł' },
    { stopien: 5, emocja: 'EXCITED', opis: 'Bardzo pomógł' },
  ];

  /** Ile odpowiedzi Emmbotka musi paść, zanim zapytamy o ocene. */
  var OCENA_PO_ODPOWIEDZIACH = 4;

  /**
   * Teksty interfejsu we wszystkich jezykach rozmowy.
   *
   * Szkola jezykowa nie moze miec bledu we wlasnym widgecie - to pierwsza rzecz,
   * po ktorej ktos oceni jej kompetencje. Tlumaczenia sa pisane z pelna interpunkcja
   * danego jezyka: hiszpanskie znaki odwrocone, francuska spacja niełamliwa przed
   * znakiem zapytania i wykrzyknikiem, apostrofy typograficzne, a w koreanskim
   * partykula dolaczona do rzeczownika zamiast osobnego slowa.
   *
   * Emmbotek i eMMa to nazwy wlasne - nie tlumaczymy ich w zadnym jezyku.
   */
  var TEKSTY = {
    "pl": {
      "zakladka": "Zapytaj Emmbotka",
      "status": "Asystent eMMa Studio · odpowiada od razu",
      "pole": "Napisz wiadomość…",
      "poleBlokada": "Najpierw potwierdź zasady powyżej",
      "rodo": "Ta rozmowa jest zapisywana lokalnie w Twojej przeglądarce, aby Emmbotek pamiętał jej kontekst.",
      "polityka": "Polityka prywatności",
      "zgodaPrzed": "Zapoznałem się z ",
      "zgodaLink": "zasadami korzystania z asystenta",
      "zgodaPo": " i akceptuję je.",
      "jezyk": "Język rozmowy",
      "nazwaPola": "Treść wiadomości do Emmbotka",
      "wyslij": "Wyślij wiadomość",
      "wyczysc": "Wyczyść rozmowę",
      "potwierdz": "Potwierdź wyczyszczenie rozmowy",
      "naPewno": "Na pewno?",
      "zamknij": "Zamknij okno rozmowy",
      "ocenaTytul": "Jak poszła nam rozmowa?",
      "ocenaDzieki": "Dziękuję za ocenę!",
      "blad": "Chwilowo nie mogę się połączyć. Proszę spróbować za moment albo napisać do sekretariatu.",
      "chipsy": [
        "Kurs dla dziecka",
        "Angielski dla mnie",
        "Szkolenie dla firmy",
        "Cennik",
        "Lekcja próbna"
      ],
      "oceny": [
        "Wcale mi nie pomógł",
        "Pomógł połowicznie",
        "W porządku",
        "Pomógł",
        "Bardzo pomógł"
      ]
    },
    "en": {
      "zakladka": "Ask Emmbotek",
      "status": "eMMa Studio assistant · replies instantly",
      "pole": "Type a message…",
      "poleBlokada": "Please confirm the terms above first",
      "rodo": "This conversation is stored locally in your browser so that Emmbotek remembers its context.",
      "polityka": "Privacy policy",
      "zgodaPrzed": "I have read the ",
      "zgodaLink": "terms of use of the assistant",
      "zgodaPo": " and I accept them.",
      "jezyk": "Conversation language",
      "nazwaPola": "Message to Emmbotek",
      "wyslij": "Send message",
      "wyczysc": "Clear conversation",
      "potwierdz": "Confirm clearing the conversation",
      "naPewno": "Are you sure?",
      "zamknij": "Close the chat window",
      "ocenaTytul": "How did our conversation go?",
      "ocenaDzieki": "Thank you for your feedback!",
      "blad": "I can’t connect right now. Please try again in a moment or contact the office.",
      "chipsy": [
        "A course for my child",
        "English for me",
        "Corporate training",
        "Prices",
        "Trial lesson"
      ],
      "oceny": [
        "Not helpful at all",
        "Somewhat helpful",
        "It was fine",
        "Helpful",
        "Very helpful"
      ]
    },
    "es": {
      "zakladka": "Pregunta a Emmbotek",
      "status": "Asistente de eMMa Studio · responde al instante",
      "pole": "Escribe un mensaje…",
      "poleBlokada": "Primero confirma las condiciones de arriba",
      "rodo": "Esta conversación se guarda localmente en tu navegador para que Emmbotek recuerde el contexto.",
      "polityka": "Política de privacidad",
      "zgodaPrzed": "He leído las ",
      "zgodaLink": "condiciones de uso del asistente",
      "zgodaPo": " y las acepto.",
      "jezyk": "Idioma de la conversación",
      "nazwaPola": "Mensaje para Emmbotek",
      "wyslij": "Enviar mensaje",
      "wyczysc": "Borrar la conversación",
      "potwierdz": "Confirmar el borrado de la conversación",
      "naPewno": "¿Seguro?",
      "zamknij": "Cerrar la ventana de chat",
      "ocenaTytul": "¿Qué tal ha ido nuestra conversación?",
      "ocenaDzieki": "¡Gracias por tu valoración!",
      "blad": "Ahora mismo no puedo conectarme. Inténtalo de nuevo en un momento o escribe a secretaría.",
      "chipsy": [
        "Un curso para mi hijo",
        "Español para mí",
        "Formación para empresas",
        "Precios",
        "Clase de prueba"
      ],
      "oceny": [
        "No me ayudó nada",
        "Me ayudó a medias",
        "Estuvo bien",
        "Me ayudó",
        "Me ayudó mucho"
      ]
    },
    "de": {
      "zakladka": "Emmbotek fragen",
      "status": "Assistent von eMMa Studio · antwortet sofort",
      "pole": "Nachricht schreiben…",
      "poleBlokada": "Bitte bestätige zuerst die Bedingungen oben",
      "rodo": "Dieses Gespräch wird lokal in deinem Browser gespeichert, damit Emmbotek den Kontext behält.",
      "polityka": "Datenschutzerklärung",
      "zgodaPrzed": "Ich habe die ",
      "zgodaLink": "Nutzungsbedingungen des Assistenten",
      "zgodaPo": " gelesen und akzeptiere sie.",
      "jezyk": "Gesprächssprache",
      "nazwaPola": "Nachricht an Emmbotek",
      "wyslij": "Nachricht senden",
      "wyczysc": "Gespräch löschen",
      "potwierdz": "Löschen des Gesprächs bestätigen",
      "naPewno": "Sicher?",
      "zamknij": "Chatfenster schließen",
      "ocenaTytul": "Wie war unser Gespräch?",
      "ocenaDzieki": "Danke für deine Bewertung!",
      "blad": "Ich kann mich gerade nicht verbinden. Bitte versuche es gleich noch einmal oder schreibe dem Sekretariat.",
      "chipsy": [
        "Kurs für mein Kind",
        "Deutsch für mich",
        "Firmenschulung",
        "Preise",
        "Probestunde"
      ],
      "oceny": [
        "Hat mir gar nicht geholfen",
        "Hat teilweise geholfen",
        "War in Ordnung",
        "Hat geholfen",
        "Hat sehr geholfen"
      ]
    },
    "fr": {
      "zakladka": "Demander à Emmbotek",
      "status": "Assistant d’eMMa Studio · répond aussitôt",
      "pole": "Écrivez un message…",
      "poleBlokada": "Confirmez d’abord les conditions ci-dessus",
      "rodo": "Cette conversation est enregistrée localement dans votre navigateur afin qu’Emmbotek en garde le contexte.",
      "polityka": "Politique de confidentialité",
      "zgodaPrzed": "J’ai lu les ",
      "zgodaLink": "conditions d’utilisation de l’assistant",
      "zgodaPo": " et je les accepte.",
      "jezyk": "Langue de la conversation",
      "nazwaPola": "Message pour Emmbotek",
      "wyslij": "Envoyer le message",
      "wyczysc": "Effacer la conversation",
      "potwierdz": "Confirmer l’effacement de la conversation",
      "naPewno": "Vraiment ?",
      "zamknij": "Fermer la fenêtre de chat",
      "ocenaTytul": "Comment s’est passée notre conversation ?",
      "ocenaDzieki": "Merci pour votre évaluation !",
      "blad": "Je n’arrive pas à me connecter pour le moment. Réessayez dans un instant ou écrivez au secrétariat.",
      "chipsy": [
        "Un cours pour mon enfant",
        "Le français pour moi",
        "Formation en entreprise",
        "Tarifs",
        "Cours d’essai"
      ],
      "oceny": [
        "Ne m’a pas aidé du tout",
        "M’a aidé à moitié",
        "C’était correct",
        "M’a aidé",
        "M’a beaucoup aidé"
      ]
    },
    "it": {
      "zakladka": "Chiedi a Emmbotek",
      "status": "Assistente di eMMa Studio · risponde subito",
      "pole": "Scrivi un messaggio…",
      "poleBlokada": "Conferma prima le condizioni qui sopra",
      "rodo": "Questa conversazione viene salvata localmente nel tuo browser affinché Emmbotek ne ricordi il contesto.",
      "polityka": "Informativa sulla privacy",
      "zgodaPrzed": "Ho letto le ",
      "zgodaLink": "condizioni d’uso dell’assistente",
      "zgodaPo": " e le accetto.",
      "jezyk": "Lingua della conversazione",
      "nazwaPola": "Messaggio per Emmbotek",
      "wyslij": "Invia il messaggio",
      "wyczysc": "Cancella la conversazione",
      "potwierdz": "Conferma la cancellazione della conversazione",
      "naPewno": "Sicuro?",
      "zamknij": "Chiudi la finestra della chat",
      "ocenaTytul": "Com’è andata la nostra conversazione?",
      "ocenaDzieki": "Grazie per la tua valutazione!",
      "blad": "Al momento non riesco a connettermi. Riprova tra un istante oppure scrivi alla segreteria.",
      "chipsy": [
        "Un corso per mio figlio",
        "L’italiano per me",
        "Formazione aziendale",
        "Prezzi",
        "Lezione di prova"
      ],
      "oceny": [
        "Non mi ha aiutato per niente",
        "Mi ha aiutato a metà",
        "Andava bene",
        "Mi ha aiutato",
        "Mi ha aiutato molto"
      ]
    },
    "ru": {
      "zakladka": "Спросить Emmbotek",
      "status": "Ассистент eMMa Studio · отвечает сразу",
      "pole": "Напишите сообщение…",
      "poleBlokada": "Сначала подтвердите правила выше",
      "rodo": "Этот разговор сохраняется локально в вашем браузере, чтобы Emmbotek помнил его контекст.",
      "polityka": "Политика конфиденциальности",
      "zgodaPrzed": "Я ознакомился с ",
      "zgodaLink": "правилами использования ассистента",
      "zgodaPo": " и принимаю их.",
      "jezyk": "Язык разговора",
      "nazwaPola": "Сообщение для Emmbotek",
      "wyslij": "Отправить сообщение",
      "wyczysc": "Очистить разговор",
      "potwierdz": "Подтвердите очистку разговора",
      "naPewno": "Точно?",
      "zamknij": "Закрыть окно чата",
      "ocenaTytul": "Как прошёл наш разговор?",
      "ocenaDzieki": "Спасибо за оценку!",
      "blad": "Сейчас не удаётся подключиться. Попробуйте через минуту или напишите в секретариат.",
      "chipsy": [
        "Курс для ребёнка",
        "Русский для меня",
        "Обучение для компании",
        "Цены",
        "Пробный урок"
      ],
      "oceny": [
        "Совсем не помог",
        "Помог наполовину",
        "Нормально",
        "Помог",
        "Очень помог"
      ]
    },
    "uk": {
      "zakladka": "Запитати Emmbotek",
      "status": "Асистент eMMa Studio · відповідає одразу",
      "pole": "Напишіть повідомлення…",
      "poleBlokada": "Спочатку підтвердьте правила вище",
      "rodo": "Ця розмова зберігається локально у вашому браузері, щоб Emmbotek пам’ятав її контекст.",
      "polityka": "Політика конфіденційності",
      "zgodaPrzed": "Я ознайомився з ",
      "zgodaLink": "правилами користування асистентом",
      "zgodaPo": " і приймаю їх.",
      "jezyk": "Мова розмови",
      "nazwaPola": "Повідомлення для Emmbotek",
      "wyslij": "Надіслати повідомлення",
      "wyczysc": "Очистити розмову",
      "potwierdz": "Підтвердьте очищення розмови",
      "naPewno": "Точно?",
      "zamknij": "Закрити вікно чату",
      "ocenaTytul": "Як пройшла наша розмова?",
      "ocenaDzieki": "Дякую за оцінку!",
      "blad": "Зараз не вдається з’єднатися. Спробуйте за хвилину або напишіть до секретаріату.",
      "chipsy": [
        "Курс для дитини",
        "Українська для мене",
        "Навчання для компанії",
        "Ціни",
        "Пробний урок"
      ],
      "oceny": [
        "Зовсім не допоміг",
        "Допоміг наполовину",
        "Нормально",
        "Допоміг",
        "Дуже допоміг"
      ]
    },
    "ko": {
      "zakladka": "Emmbotek에게 문의",
      "status": "eMMa Studio 어시스턴트 · 바로 답변",
      "pole": "메시지를 입력하세요…",
      "poleBlokada": "먼저 위의 이용 약관에 동의해 주세요",
      "rodo": "이 대화는 Emmbotek이 맥락을 기억할 수 있도록 브라우저에 로컬로 저장됩니다.",
      "polityka": "개인정보 처리방침",
      "zgodaPrzed": "",
      "zgodaLink": "어시스턴트 이용 약관",
      "zgodaPo": "을 읽고 동의합니다.",
      "jezyk": "대화 언어",
      "nazwaPola": "Emmbotek에게 보낼 메시지",
      "wyslij": "메시지 보내기",
      "wyczysc": "대화 지우기",
      "potwierdz": "대화 삭제 확인",
      "naPewno": "삭제할까요?",
      "zamknij": "채팅 창 닫기",
      "ocenaTytul": "대화는 어떠셨나요?",
      "ocenaDzieki": "평가해 주셔서 감사합니다!",
      "blad": "지금은 연결할 수 없습니다. 잠시 후 다시 시도하시거나 사무실로 문의해 주세요.",
      "chipsy": [
        "자녀를 위한 수업",
        "나를 위한 한국어",
        "기업 교육",
        "수강료",
        "체험 수업"
      ],
      "oceny": [
        "전혀 도움이 되지 않았어요",
        "절반쯤 도움이 됐어요",
        "괜찮았어요",
        "도움이 됐어요",
        "아주 큰 도움이 됐어요"
      ]
    }
  };

  /** Tekst w jezyku rozmowy, z zapasem po polsku. */
  function t(klucz) {
    var kod = (state.conversation && state.conversation.jezykRozmowy) || 'pl';
    var zestaw = TEKSTY[kod] || TEKSTY.pl;
    return zestaw[klucz] !== undefined ? zestaw[klucz] : TEKSTY.pl[klucz];
  }

  /**
   * Flagi jako SVG, a nie emoji.
   *
   * Windows nie ma glifow flag w emoji - zamiast flagi pokazuje pare liter ("PL"),
   * a to na widgecie szkoly jezykowej wyglada jak blad. Rysunki sa uproszczone
   * do rozmiaru 20x14 px: przy tej wielkosci herb Hiszpanii czy pelne trigramy
   * Korei zamienilyby sie w plame, wiec zostaje to, co czyni flage rozpoznawalna.
   */
  var FLAGI = {
    "pl": "<rect width=\"20\" height=\"7\" fill=\"#fff\"/><rect y=\"7\" width=\"20\" height=\"7\" fill=\"#DC143C\"/>",
    "en": "<rect width=\"20\" height=\"14\" fill=\"#012169\"/><path d=\"M0 0l20 14M20 0L0 14\" stroke=\"#fff\" stroke-width=\"2.8\"/><path d=\"M0 0l20 14M20 0L0 14\" stroke=\"#C8102E\" stroke-width=\"1.6\"/><path d=\"M10 0v14M0 7h20\" stroke=\"#fff\" stroke-width=\"4.6\"/><path d=\"M10 0v14M0 7h20\" stroke=\"#C8102E\" stroke-width=\"2.8\"/>",
    "es": "<rect width=\"20\" height=\"14\" fill=\"#AA151B\"/><rect y=\"3.5\" width=\"20\" height=\"7\" fill=\"#F1BF00\"/>",
    "de": "<rect width=\"20\" height=\"4.67\" fill=\"#000\"/><rect y=\"4.67\" width=\"20\" height=\"4.67\" fill=\"#DD0000\"/><rect y=\"9.34\" width=\"20\" height=\"4.66\" fill=\"#FFCE00\"/>",
    "fr": "<rect width=\"6.67\" height=\"14\" fill=\"#002395\"/><rect x=\"6.67\" width=\"6.66\" height=\"14\" fill=\"#fff\"/><rect x=\"13.33\" width=\"6.67\" height=\"14\" fill=\"#ED2939\"/>",
    "it": "<rect width=\"6.67\" height=\"14\" fill=\"#008C45\"/><rect x=\"6.67\" width=\"6.66\" height=\"14\" fill=\"#F4F5F0\"/><rect x=\"13.33\" width=\"6.67\" height=\"14\" fill=\"#CD212A\"/>",
    "ru": "<rect width=\"20\" height=\"4.67\" fill=\"#fff\"/><rect y=\"4.67\" width=\"20\" height=\"4.67\" fill=\"#0039A6\"/><rect y=\"9.34\" width=\"20\" height=\"4.66\" fill=\"#D52B1E\"/>",
    "uk": "<rect width=\"20\" height=\"7\" fill=\"#0057B7\"/><rect y=\"7\" width=\"20\" height=\"7\" fill=\"#FFD700\"/>",
    "ko": "<rect width=\"20\" height=\"14\" fill=\"#fff\"/><g transform=\"rotate(-33.7 10.0 7.0)\"><circle cx=\"10.0\" cy=\"7.0\" r=\"3.95\" fill=\"#0047A0\"/><path d=\"M6.05 7.00 A3.95 3.95 0 0 1 13.95 7.00 A1.975 1.975 0 0 1 10.00 7.00 A1.975 1.975 0 0 0 6.05 7.00 Z\" fill=\"#CD2E3A\"/></g><g fill=\"#0A0A0A\"><g transform=\"translate(3.95 3.20) rotate(-56.3)\"><rect x=\"-2.30\" y=\"-1.79\" width=\"4.60\" height=\"0.90\"/><rect x=\"-2.30\" y=\"-0.45\" width=\"4.60\" height=\"0.90\"/><rect x=\"-2.30\" y=\"0.89\" width=\"4.60\" height=\"0.90\"/></g><g transform=\"translate(16.05 3.20) rotate(56.3)\"><rect x=\"-2.30\" y=\"-1.79\" width=\"1.87\" height=\"0.90\"/><rect x=\"0.42\" y=\"-1.79\" width=\"1.87\" height=\"0.90\"/><rect x=\"-2.30\" y=\"-0.45\" width=\"4.60\" height=\"0.90\"/><rect x=\"-2.30\" y=\"0.89\" width=\"1.87\" height=\"0.90\"/><rect x=\"0.42\" y=\"0.89\" width=\"1.87\" height=\"0.90\"/></g><g transform=\"translate(3.95 10.80) rotate(56.3)\"><rect x=\"-2.30\" y=\"-1.79\" width=\"4.60\" height=\"0.90\"/><rect x=\"-2.30\" y=\"-0.45\" width=\"1.87\" height=\"0.90\"/><rect x=\"0.42\" y=\"-0.45\" width=\"1.87\" height=\"0.90\"/><rect x=\"-2.30\" y=\"0.89\" width=\"4.60\" height=\"0.90\"/></g><g transform=\"translate(16.05 10.80) rotate(-56.3)\"><rect x=\"-2.30\" y=\"-1.79\" width=\"1.87\" height=\"0.90\"/><rect x=\"0.42\" y=\"-1.79\" width=\"1.87\" height=\"0.90\"/><rect x=\"-2.30\" y=\"-0.45\" width=\"1.87\" height=\"0.90\"/><rect x=\"0.42\" y=\"-0.45\" width=\"1.87\" height=\"0.90\"/><rect x=\"-2.30\" y=\"0.89\" width=\"1.87\" height=\"0.90\"/><rect x=\"0.42\" y=\"0.89\" width=\"1.87\" height=\"0.90\"/></g></g>"
  };

  /** Element <svg> z flaga danego jezyka. */
  function flaga(kod) {
    var svg = '<svg viewBox="0 0 20 14" width="20" height="14" aria-hidden="true" focusable="false">'
      + (FLAGI[kod] || '') + '</svg>';
    var opakowanie = el('span', 'emma__flaga');
    opakowanie.innerHTML = svg;   // tresc wpisana na stale w kodzie, nie z sieci
    return opakowanie;
  }
  var POWITANIA = {
    pl: 'Dzień dobry! Jestem Emmbotek, asystent eMMa Studio. W czym mogę pomóc?',
    en: 'Hi! I am Emmbotek, the eMMa Studio assistant. How can I help?',
    es: '¡Hola! Soy Emmbotek, el asistente de eMMa Studio. ¿En qué puedo ayudarte?',
    de: 'Guten Tag! Ich bin Emmbotek, der Assistent von eMMa Studio. Wie kann ich helfen?',
    fr: 'Bonjour ! Je suis Emmbotek, l’assistant d’eMMa Studio. Comment puis-je aider ?',
    it: 'Ciao! Sono Emmbotek, l’assistente di eMMa Studio. Come posso aiutarti?',
    ru: 'Здравствуйте! Я Emmbotek, ассистент eMMa Studio. Чем могу помочь?',
    uk: 'Вітаю! Я Emmbotek, асистент eMMa Studio. Чим можу допомогти?',
    ko: '안녕하세요! eMMa Studio 어시스턴트 Emmbotek입니다. 무엇을 도와드릴까요?',
  };
  var CONSENT_KEY = 'emma-ai-rodo-ack-v1';
  var MAX_CHARS = 600;

  var DEFAULTS = {
    apiUrl: '/api/chat',
    analyticsUrl: '/api/analytics',
    tokenUrl: '/api/token',
    assetsBase: '/',
    /*
      Napisy domyslnie brane z tablicy tlumaczen (TEKSTY) wedlug jezyka rozmowy.
      `null` znaczy "uzyj tlumaczenia"; wpisanie tu wlasnego tekstu przy init()
      nadpisuje go we WSZYSTKICH jezykach - wiec robimy to tylko swiadomie.
      `title` zostaje na stale: Emmbotek to nazwa wlasna, nie tlumaczymy jej.
    */
    tabLabel: null,
    title: 'Emmbotek',
    status: null,
    greeting: null,
    rodoNote: null,
    privacyUrl: null,
    /** Adres zasad korzystania z asystenta. Domyslnie ta sama strona, co polityka. */
    rulesUrl: null,
    startChips: null,
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
    token: null,
    tokenDo: 0,
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
      // jezyk ROZMOWY (nie jezyk, ktorego uczy sie uzytkownik - ten jest w profil.jezyk)
      jezykRozmowy: 'pl',
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

  /**
   * Kasowanie rozmowy w DWOCH krokach.
   *
   * Kosz kasuje bezpowrotnie, a cel ma 38 px - jedno omylkowe tapniecie na telefonie
   * i cala rozmowa przepada bez sladu. Zamiast okna dialogowego (ciezkie i wyrywa
   * z kontekstu w tak malym oknie) przycisk sam sie "uzbraja": rozsuwa sie w pastylke
   * z pytaniem "Na pewno?", a dopiero drugie klikniecie kasuje.
   *
   * Rozbrojenie nastepuje samo po 4 sekundach albo przy klknieciu gdziekolwiek indziej -
   * zeby uzbrojony przycisk nie czekal w nieskonczonosc na przypadkowy dotyk.
   */
  function rozbrojKosz() {
    if (!state.koszUzbrojony) return;
    state.koszUzbrojony = false;
    state.nodes.clear.removeAttribute('data-uzbrojony');
    state.nodes.clear.setAttribute('aria-label', t('wyczysc'));
    global.clearTimeout(state.koszTimer);
  }

  function koszKliniety() {
    if (state.koszUzbrojony) {
      rozbrojKosz();
      clearConversation();
      return;
    }
    // Pusta rozmowa nie ma czego kasowac - nie ma tez o co pytac.
    if (!state.conversation.messages.length) {
      clearConversation();
      return;
    }
    state.koszUzbrojony = true;
    state.nodes.clear.setAttribute('data-uzbrojony', 'true');
    state.nodes.clear.setAttribute('aria-label', t('potwierdz'));
    announce('Kliknij ponownie, aby wyczyścić rozmowę.');
    global.clearTimeout(state.koszTimer);
    state.koszTimer = global.setTimeout(rozbrojKosz, 4000);
  }

  function clearConversation() {
    try { global.localStorage.removeItem(STORAGE_KEY); } catch (error) { /* ignorujemy */ }
    state.conversation = emptyConversation();
    state.shownCtas = [];
    state.ocenaPokazana = false;
    state.nodes.ocena.hidden = true;
    state.nodes.log.innerHTML = '';
    addMessage('model', powitanie(), { emotion: 'GREETING', save: false });
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
    var tabLabel = el('span', 'emma__tab-label', state.options.tabLabel || t('zakladka'));
    tab.appendChild(tabLabel);

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
    var status = el('p', 'emma__status', state.options.status || t('status'));
    headText.appendChild(title);
    headText.appendChild(status);

    var clearBtn = el('button', 'emma__icon-btn emma__icon-btn--kosz', '');
    clearBtn.type = 'button';
    clearBtn.title = 'Wyczyść rozmowę';
    clearBtn.setAttribute('aria-label', 'Wyczyść rozmowę');
    // Kosz: wieko z uchwytem, korpus i dwie kreski w srodku. Grubsza kreska (2)
    // i zaokraglone konce - przy 20 px cienka linia rozmywa sie na ekranach 1x.
    // Wieko jest osobna grupa, zeby dalo sie je unosic przy najechaniu -
    // drobny ruch, ktory od razu mowi, co ten przycisk robi.
    clearBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
      + '<g class="emma__kosz-wieko"><path d="M4 7h16"/><path d="M9.5 7V5.4c0-.5.4-.9.9-.9h3.2c.5 0 .9.4.9.9V7"/></g>'
      + '<path d="M6.4 7.9l.8 10.3c.05.7.63 1.3 1.35 1.3h6.9c.72 0 1.3-.6 1.35-1.3l.8-10.3"/>'
      + '<path d="M10.3 11v5M13.7 11v5"/>'
      + '</svg>'
      + '<span class="emma__btn-label"></span>';
    var koszEtykieta = clearBtn.querySelector('.emma__btn-label');
    koszEtykieta.textContent = t('naPewno');

    var closeBtn = el('button', 'emma__icon-btn emma__icon-btn--zamknij', '');
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
    input.placeholder = t('pole');
    input.setAttribute('aria-label', t('nazwaPola'));
    var counter = el('span', 'emma__counter', '0/' + MAX_CHARS);
    counter.setAttribute('aria-hidden', 'true');
    var send = el('button', 'emma__send');
    send.type = 'submit';
    send.setAttribute('aria-label', t('wyslij'));
    send.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.6 20.4 21 12 3.6 3.6 3.6 10.2 15 12 3.6 13.8z" fill="currentColor"/></svg>';
    // Przycisk wysylania siedzi WEWNATRZ pola, a nie obok niego. Wczesniej byly to
    // dwa osobne klocki, ktore rosly niezaleznie - przy dluzszym tekscie pole
    // wyciagalo sie w gore, a przycisk zostawal przyklejony do dolu i cala rzecz
    // rozjezdzala sie na dwie czesci. Teraz to jedno pudelko, ktore skaluje sie
    // razem z trescia.
    field.appendChild(input);
    field.appendChild(counter);
    field.appendChild(send);
    form.appendChild(field);

    // Stopka informacyjna: sama tresc RODO i odnosnik do polityki prywatnosci.
    // "Wyczysc rozmowe" bylo tu drugi raz - ta sama czynnosc ma juz ikone kosza
    // w naglowku panelu, a dwa wejscia do jednej akcji w tak malym oknie tylko
    // rozpraszaly. Zostaje ikona, bo jest zawsze widoczna, takze przy dlugiej rozmowie.
    var privacy = null;
    var note = el('p', 'emma__note');
    // tresc RODO w osobnym elemencie, zeby dalo sie ja podmienic przy zmianie jezyka
    var rodoTekst = el('span', null, state.options.rodoNote || t('rodo'));
    note.appendChild(rodoTekst);
    if (state.options.privacyUrl) {
      privacy = el('a', 'emma__link', t('polityka'));
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
    var zgodaPrzed = el('span', null, t('zgodaPrzed'));
    zgodaEtykieta.appendChild(zgodaPrzed);

    var zasady = el('a', 'emma__link', t('zgodaLink'));
    zasady.href = state.options.rulesUrl || state.options.privacyUrl || '#';
    zasady.target = '_blank';
    zasady.rel = 'noopener';
    zgodaEtykieta.appendChild(zasady);
    var zgodaPo = el('span', null, t('zgodaPo'));
    zgodaEtykieta.appendChild(zgodaPo);

    zgoda.appendChild(zgodaPole);
    zgoda.appendChild(zgodaEtykieta);

    /*
      Pasek wyboru jezyka rozmowy. Szkola uczy dziewieciu jezykow, wiec rozmowa
      z Emmbotkiem w kazdym z nich jest jednoczesnie pokazem tego, co sprzedaje -
      i darmowa okazja do praktyki dla kursanta.

      Zwykly <select>, a nie wlasna lista: dziala z klawiatura i czytnikiem ekranu
      bez pisania czegokolwiek, a na telefonie otwiera natywny wybierak systemowy,
      ktory jest wygodniejszy niz cokolwiek, co dalo by sie tu narysowac.
    */
    var jezykiPasek = el('div', 'emma__jezyki');
    var jezykEtykieta = el('span', 'emma__jezyki-etykieta', t('jezyk'));

    /*
      Wlasna lista zamiast <select>.

      Natywny <select> nie przyjmuje grafiki w opcjach - flage dalo sie w nim pokazac
      tylko jako emoji, a Windows nie ma glifow flag i wyswietlal pare liter. Na widgecie
      szkoly jezykowej wyglada to jak usterka.

      Za dostepnosc odpowiada wzorzec listy: przycisk z aria-haspopup, lista z rolami
      listbox/option, obsluga strzalek, Home/End, Escape i Enter. Klikniecie poza lista
      ja zamyka, a fokus wraca na przycisk.
    */
    var jezykPrzycisk = el('button', 'emma__jezyk-przycisk');
    jezykPrzycisk.type = 'button';
    jezykPrzycisk.setAttribute('aria-haspopup', 'listbox');
    jezykPrzycisk.setAttribute('aria-expanded', 'false');
    var jezykPrzyciskTekst = el('span', 'emma__jezyk-nazwa');

    var jezykLista = el('div', 'emma__jezyk-lista');
    jezykLista.setAttribute('role', 'listbox');
    jezykLista.hidden = true;

    JEZYKI.forEach(function (jezyk) {
      var opcja = el('button', 'emma__jezyk-opcja');
      opcja.type = 'button';
      opcja.setAttribute('role', 'option');
      opcja.setAttribute('data-kod', jezyk.kod);
      opcja.appendChild(flaga(jezyk.kod));
      opcja.appendChild(el('span', 'emma__jezyk-nazwa', jezyk.wlasna));
      opcja.addEventListener('click', function () {
        zmienJezyk(jezyk.kod);
        zamknijListeJezykow(true);
      });
      jezykLista.appendChild(opcja);
    });

    var jezykPole = el('div', 'emma__jezyk-pole');
    jezykPole.appendChild(jezykPrzycisk);
    jezykPole.appendChild(jezykLista);

    jezykiPasek.appendChild(jezykEtykieta);
    jezykiPasek.appendChild(jezykPole);

    // Panel oceny - schowany do czasu, az rozmowa bedzie na tyle dluga, zeby bylo co oceniac.
    var ocena = el('div', 'emma__ocena');
    ocena.hidden = true;
    var ocenaTytul = el('p', 'emma__ocena-tytul', t('ocenaTytul'));
    var ocenaMiny = el('div', 'emma__ocena-miny');
    ocena.appendChild(ocenaTytul);
    ocena.appendChild(ocenaMiny);

    var live = el('p', 'emma__sr');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');

    panel.appendChild(header);
    panel.appendChild(jezykiPasek);
    panel.appendChild(log);
    panel.appendChild(ocena);
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
      jezykPrzycisk: jezykPrzycisk, jezykPrzyciskTekst: jezykPrzyciskTekst, jezykLista: jezykLista,
      ocena: ocena, ocenaMiny: ocenaMiny, ocenaTytul: ocenaTytul,
      tabLabel: tabLabel, status: status, jezykEtykieta: jezykEtykieta,
      koszEtykieta: koszEtykieta, rodoTekst: rodoTekst, privacy: privacy,
      zgodaPrzed: zgodaPrzed, zgodaLink: zasady, zgodaPo: zgodaPo,
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
    return state.options.startChips || t('chipsy');
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

  /* ------------------------------------------------------------ token wstepu */

  /**
   * Krotkotrwaly podpis, ktory backend wystawia naszej stronie.
   *
   * Nie jest tajemnica i nie uwierzytelnia uzytkownika - ma tylko sprawic, ze zeby
   * zadac pytanie, trzeba najpierw przejsc przez nasza strone. Zwykly skrypt strzelajacy
   * do /api/chat tego nie robi.
   *
   * Gdy backend nie wymaga tokenu (brak TOKEN_SECRET), oddaje `null` i widget dziala
   * dokladnie jak dotad.
   */
  function pobierzToken(wymus) {
    if (!wymus && state.token && state.tokenDo > Date.now() + 30000) {
      return Promise.resolve(state.token);
    }
    return global.fetch(state.options.tokenUrl, { method: 'GET', credentials: 'omit' })
      .then(function (r) {
        // Zle ustawiony tokenUrl wskazuje na wlasna strone, a ta oddaje index.html
        // ze statusem 200. Bez tego sprawdzenia widget po cichu zostawal bez tokenu
        // i kazda wiadomosc konczyla sie bledem 401 - bez sladu, gdzie szukac.
        var typ = r.headers.get('content-type') || '';
        if (!r.ok || typ.indexOf('json') === -1) {
          if (global.console && global.console.warn) {
            global.console.warn('[Emmbotek] ' + state.options.tokenUrl + ' nie zwraca JSON-a (status '
              + r.status + ', typ "' + typ + '"). Sprawdz opcje tokenUrl przy init().');
          }
          return null;
        }
        return r.json();
      })
      .then(function (dane) {
        if (!dane) return null;
        state.token = dane.token || null;
        state.tokenDo = dane.expiresAt || 0;
        return state.token;
      })
      .catch(function () { return null; });   // brak tokenu nie blokuje proby wyslania
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

    var tresc = JSON.stringify({
      message: message,
      history: historyForApi(),
      currentUrl: global.location ? global.location.href : null,
      currentPageTitle: doc.title || null,
      pageType: pageType(),
      profile: state.conversation.profil,
      language: state.conversation.jezykRozmowy || 'pl',
      shownCtas: state.shownCtas.slice(-10),
    });

    function wyslijZ(token) {
      var naglowki = { 'content-type': 'application/json' };
      if (token) naglowki['x-emmbotek-token'] = token;
      return fetch(state.options.apiUrl, { method: 'POST', headers: naglowki, body: tresc })
        .then(function (response) {
          return response.json().then(function (data) { return { status: response.status, data: data }; });
        });
    }

    pobierzToken(false)
      .then(wyslijZ)
      .then(function (result) {
        // Token wygasl w trakcie dlugiej rozmowy - bierzemy nowy i ponawiamy RAZ.
        // Bez tego uzytkownik dostawalby blad po dwudziestu minutach pisania.
        if (result.status === 401 && result.data && result.data.odswiezToken) {
          return pobierzToken(true).then(wyslijZ);
        }
        return result;
      })
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
        pokazOcene();
      })
      .catch(function () {
        typing.remove();
        if (state.avatar) state.avatar.set('EMPATHY');
        addMessage('model', t('blad'), { save: false });
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
    state.nodes.input.placeholder = zgodzil ? t('pole') : t('poleBlokada');
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

  /** Powitanie w jezyku wybranym do rozmowy - z zapasem po polsku. */
  function powitanie() {
    var kod = state.conversation.jezykRozmowy || 'pl';
    if (kod === 'pl' && state.options.greeting) return state.options.greeting;
    return POWITANIA[kod] || state.options.greeting || POWITANIA.pl;
  }

  /**
   * Zmiana jezyka rozmowy.
   *
   * Historii NIE kasujemy - ktos moze zaczac po polsku, a potem chciec poćwiczyc
   * hiszpanski w tej samej rozmowie i Emmbotek ma nadal pamietac, o czym byla mowa.
   * Zmieniamy tylko jezyk kolejnych odpowiedzi i podpowiedzi startowe.
   */
  /** Przepisuje wszystkie napisy interfejsu na jezyk rozmowy. */
  function odswiezTeksty() {
    var n = state.nodes;
    n.tabLabel.textContent = t('zakladka');
    n.tab.setAttribute('aria-label', t('zakladka'));
    n.status.textContent = t('status');
    n.jezykEtykieta.textContent = t('jezyk');
    n.input.setAttribute('aria-label', t('nazwaPola'));
    n.send.setAttribute('aria-label', t('wyslij'));
    n.close.setAttribute('aria-label', t('zamknij'));
    n.clear.setAttribute('aria-label', state.koszUzbrojony ? t('potwierdz') : t('wyczysc'));
    n.koszEtykieta.textContent = t('naPewno');
    n.ocenaTytul.textContent = t('ocenaTytul');
    n.rodoTekst.textContent = t('rodo');
    if (n.privacy) n.privacy.textContent = t('polityka');
    n.zgodaPrzed.textContent = t('zgodaPrzed');
    n.zgodaLink.textContent = t('zgodaLink');
    n.zgodaPo.textContent = t('zgodaPo');
    odswiezZgode();
  }

  /** Odswieza przycisk listy: flaga i nazwa aktualnego jezyka. */
  function odswiezPrzyciskJezyka() {
    var kod = state.conversation.jezykRozmowy || 'pl';
    var jezyk = JEZYKI.filter(function (j) { return j.kod === kod; })[0] || JEZYKI[0];
    var przycisk = state.nodes.jezykPrzycisk;
    przycisk.innerHTML = '';
    przycisk.appendChild(flaga(kod));
    przycisk.appendChild(el('span', 'emma__jezyk-nazwa', jezyk.wlasna));
    przycisk.appendChild(el('span', 'emma__jezyk-strzalka'));
    przycisk.setAttribute('aria-label', t('jezyk') + ': ' + jezyk.wlasna);
    var opcje = state.nodes.jezykLista.querySelectorAll('.emma__jezyk-opcja');
    for (var i = 0; i < opcje.length; i += 1) {
      var wybrana = opcje[i].getAttribute('data-kod') === kod;
      opcje[i].setAttribute('aria-selected', wybrana ? 'true' : 'false');
    }
  }

  function otworzListeJezykow() {
    state.nodes.jezykLista.hidden = false;
    state.nodes.jezykPrzycisk.setAttribute('aria-expanded', 'true');
    var wybrana = state.nodes.jezykLista.querySelector('[aria-selected="true"]')
      || state.nodes.jezykLista.firstChild;
    if (wybrana) wybrana.focus();
  }

  function zamknijListeJezykow(wrocFokusem) {
    if (state.nodes.jezykLista.hidden) return;
    state.nodes.jezykLista.hidden = true;
    state.nodes.jezykPrzycisk.setAttribute('aria-expanded', 'false');
    if (wrocFokusem) state.nodes.jezykPrzycisk.focus();
  }

  /** Strzalki, Home/End, Escape i Enter w otwartej liscie. */
  function klawiszWLiscieJezykow(event) {
    var opcje = [].slice.call(state.nodes.jezykLista.querySelectorAll('.emma__jezyk-opcja'));
    var teraz = opcje.indexOf(doc.activeElement);
    var cel = null;
    if (event.key === 'ArrowDown') cel = opcje[Math.min(teraz + 1, opcje.length - 1)];
    else if (event.key === 'ArrowUp') cel = opcje[Math.max(teraz - 1, 0)];
    else if (event.key === 'Home') cel = opcje[0];
    else if (event.key === 'End') cel = opcje[opcje.length - 1];
    else if (event.key === 'Escape') { event.preventDefault(); zamknijListeJezykow(true); return; }
    if (cel) { event.preventDefault(); cel.focus(); }
  }

  function zmienJezyk(kod) {
    state.conversation.jezykRozmowy = kod;
    saveConversation();
    odswiezTeksty();
    odswiezPrzyciskJezyka();
    renderChips(startChips());
    var jezyk = JEZYKI.filter(function (j) { return j.kod === kod; })[0];
    if (state.nodes.panel) state.nodes.panel.setAttribute('lang', kod);
    if (!state.conversation.messages.length) {
      // Pusta rozmowa: podmieniamy samo powitanie, zeby od razu bylo widac zmiane.
      state.nodes.log.innerHTML = '';
      addMessage('model', powitanie(), { emotion: 'GREETING', save: false });
    }
    announce('Język rozmowy: ' + (jezyk ? jezyk.wlasna : kod));
    if (state.avatar) state.avatar.set('SMILE');
  }

  /* ------------------------------------------------------------------ ocena */

  /**
   * Panel oceny pokazuje sie raz na rozmowe, po czterech odpowiedziach Emmbotka.
   *
   * Wczesniej nie ma czego oceniac, a proszenie o ocene po jednym zdaniu jest
   * natretne. Raz oceniona rozmowa nie pyta ponownie - decyzja jedzie razem z nia
   * w pamieci przegladarki, wiec przetrwa odswiezenie strony.
   */
  function odpowiedziEmmbotka() {
    return state.conversation.messages.filter(function (m) { return m.role === 'model'; }).length;
  }

  function mozeZapytacOOcene() {
    return !state.conversation.ocena
      && !state.ocenaPokazana
      && odpowiedziEmmbotka() >= OCENA_PO_ODPOWIEDZIACH;
  }

  function wyslijOcene(stopien) {
    state.conversation.ocena = stopien;
    saveConversation();
    try {
      var dane = JSON.stringify({ events: [{
        event: 'ocena',
        rating: stopien,
        currentPage: global.location ? global.location.href : null,
      }] });
      // sendBeacon przezywa zamkniecie karty tuz po klknieciu - a wlasnie wtedy
      // ludzie najczesciej oceniaja i zamykaja okno.
      if (global.navigator && global.navigator.sendBeacon) {
        global.navigator.sendBeacon(state.options.analyticsUrl, new Blob([dane], { type: 'application/json' }));
      } else {
        global.fetch(state.options.analyticsUrl, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: dane, keepalive: true,
        }).catch(function () { /* telemetria nie psuje UX */ });
      }
    } catch (error) { /* telemetria nie psuje UX */ }

    state.nodes.ocenaMiny.innerHTML = '';
    state.nodes.ocenaTytul.textContent = t('ocenaDzieki');
    if (state.avatar) state.avatar.set(stopien >= 4 ? 'PROUD' : 'EMPATHY');
    announce('Ocena zapisana. Dziękuję.');
    global.setTimeout(function () { state.nodes.ocena.hidden = true; }, 2600);
  }

  function pokazOcene() {
    if (!mozeZapytacOOcene()) return;
    state.ocenaPokazana = true;
    state.nodes.ocenaMiny.innerHTML = '';

    OCENY.forEach(function (pozycja) {
      var przycisk = el('button', 'emma__ocena-mina');
      przycisk.type = 'button';
      przycisk.title = pozycja.opis;
      przycisk.setAttribute('aria-label', pozycja.stopien + ' z 5 - ' + pozycja.opis);
      var mina = messageAvatar(pozycja.emocja);
      if (mina) {
        mina.className = 'emma__ocena-obrazek';
        przycisk.appendChild(mina);
      } else {
        przycisk.textContent = String(pozycja.stopien);
      }
      przycisk.addEventListener('click', function () { wyslijOcene(pozycja.stopien); });
      state.nodes.ocenaMiny.appendChild(przycisk);
    });

    state.nodes.ocena.hidden = false;
    scrollLog();
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
      addMessage('model', powitanie(), { emotion: 'GREETING', save: false });
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

    // Token bierzemy z wyprzedzeniem, zeby pierwsze pytanie nie czekalo na dodatkowe
    // zapytanie do serwera.
    pobierzToken(false);

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
    // Najpierw zerujemy, zeby scrollHeight policzyl sie od nowa - bez tego pole
    // potrafi tylko rosnac i nigdy nie wraca do jednej linijki po skasowaniu tekstu.
    var pole = state.nodes.input;
    pole.style.height = 'auto';
    var wysokosc = Math.min(132, pole.scrollHeight);
    pole.style.height = wysokosc + 'px';
    // Powyzej gornej granicy pole przestaje rosnac i zaczyna sie przewijac.
    pole.style.overflowY = pole.scrollHeight > 132 ? 'auto' : 'hidden';
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
    odswiezPrzyciskJezyka();
    state.nodes.panel.setAttribute('lang', state.conversation.jezykRozmowy || 'pl');
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
    state.nodes.clear.addEventListener('click', koszKliniety);
    state.nodes.panel.addEventListener('click', function (event) {
      if (!state.nodes.clear.contains(event.target)) rozbrojKosz();
    });
    state.nodes.form.addEventListener('submit', function (event) {
      event.preventDefault();
      send(state.nodes.input.value);
    });
    state.nodes.jezykPrzycisk.addEventListener('click', function () {
      if (state.nodes.jezykLista.hidden) otworzListeJezykow();
      else zamknijListeJezykow(true);
    });
    state.nodes.jezykLista.addEventListener('keydown', klawiszWLiscieJezykow);
    // Klikniecie gdziekolwiek poza lista ja zamyka - bez tego zostaje otwarta
    // i zaslania rozmowe.
    doc.addEventListener('click', function (event) {
      if (!state.nodes.jezykPrzycisk.contains(event.target)
        && !state.nodes.jezykLista.contains(event.target)) zamknijListeJezykow(false);
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
