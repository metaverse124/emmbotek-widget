/** Walidacja wejscia do /api/chat (sekcja 36 briefu). */
import config from '../config.js';

const MAX_URL = 500;

export function validateChatRequest(body) {
  const errors = [];
  const message = typeof body?.message === 'string' ? body.message.trim() : '';

  if (!message) errors.push('Pusta wiadomosc.');
  if (message.length > config.limits.maxMessageChars) {
    errors.push(`Wiadomosc moze miec maksymalnie ${config.limits.maxMessageChars} znakow.`);
  }
  if (body?.history && !Array.isArray(body.history)) errors.push('Pole history musi byc tablica.');
  if (Array.isArray(body?.history) && body.history.length > 100) errors.push('Zbyt dluga historia rozmowy.');

  const safeUrl = (value) => {
    if (typeof value !== 'string' || !value) return null;
    if (value.length > MAX_URL) return null;
    return /^https?:\/\//.test(value) || value.startsWith('/') ? value : null;
  };

  return {
    ok: errors.length === 0,
    errors,
    value: {
      message,
      history: Array.isArray(body?.history) ? body.history : [],
      currentUrl: safeUrl(body?.currentUrl),
      currentPageTitle: typeof body?.currentPageTitle === 'string' ? body.currentPageTitle.slice(0, 200) : null,
      pageType: typeof body?.pageType === 'string' ? body.pageType.slice(0, 40) : null,
      // Jezyk rozmowy tylko z listy oferowanej przez szkole - dowolny ciag z frontendu
      // trafialby prosto do System Promptu, a to droga do wstrzykniecia instrukcji.
      language: config.school.chatLanguages.some((item) => item.kod === body?.language)
        ? body.language
        : 'pl',
      profile: body?.profile && typeof body.profile === 'object' ? body.profile : {},
      shownCtas: Array.isArray(body?.shownCtas) ? body.shownCtas.filter((item) => typeof item === 'string').slice(0, 20) : [],
    },
  };
}
