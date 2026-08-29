/**
 * Atrapa modelu na potrzeby dema i testow manualnych (bez klucza Gemini).
 * Zwraca poprawny kontrakt: [EMOCJA] + tresc + ewentualne CTA,
 * zeby mozna bylo zobaczyc caly UX widgetu i animacje awatara.
 */
import { detectIntent } from '../src/agent/intents.js';

const REPLIES = {
  GREETING: ['[GREETING] Dzien dobry! W czym moge dzis pomoc?', []],
  PRICE: ['[NEUTRAL] Aktualne stawki roznia sie w zaleznosci od trybu i liczby osob w grupie, dlatego podaje je zawsze z cennika, a nie z pamieci. Zajrzy Pan/Pani do aktualnej tabeli?', [{ type: 'VIEW_PRICE' }]],
  CHILD: ['[SMILE] Dla dziewieciolatki najlepiej sprawdza sie zajecia w kameralnej grupie rowiesnikow - dzieci ucza sie tam przez zabawe i mowienie, a nie przez cisze przy tablicy. Czy corka miala juz wczesniej kontakt z angielskim?', [{ type: 'VIEW_FOR_CHILDREN' }]],
  COMPANY: ['[FOCUS] Dla firm ukladamy program pod realne sytuacje zawodowe zespolu - spotkania, mejle, prezentacje. Ilu pracownikow miloby uczestniczyc w szkoleniu?', [{ type: 'VIEW_FOR_COMPANIES' }]],
  EXAM: ['[PROUD] Przygotowujemy do FCE, CAE, IELTS i TOEFL. Kluczowe jest ustalenie punktu startowego - czy zna Pan/Pani swoj obecny poziom?', [{ type: 'VIEW_EXAM' }, { type: 'LEVEL_TEST' }]],
  TRIAL_LESSON: ['[EXCITED] Bezplatna lekcja probna to najprostszy sposob, zeby sprawdzic grupe bez zobowiazan. Umowi sie Pan/Pani na termin?', [{ type: 'TRIAL_LESSON' }]],
  LANGUAGE_QUESTION: ['[FOCUS] "Nevertheless" znaczy "niemniej jednak" i laczy dwa zdania mimo przeciwnego sensu: "It was raining; nevertheless, we went out." W mowie brzmi formalnie - w rozmowie czesciej uslyszy Pan/Pani "still" albo "anyway".', []],
  CONTACT: ['[NEUTRAL] Najszybciej pomoze sekretariat - tam sa aktualne terminy i wolne miejsca.', [{ type: 'CONTACT' }]],
  GENERAL: ['[CURIOUS] Chetnie pomoge dobrac kurs. Dla kogo szukamy zajec - dla dziecka, dla siebie czy dla zespolu w firmie?', []],
};

export async function demoGenerate({ contents = [] } = {}) {
  const last = [...contents].reverse().find((item) => item.role === 'user');
  const message = last?.parts?.[0]?.text ?? '';
  const { intent } = detectIntent(message);

  const isFirst = contents.filter((item) => item.role === 'user').length === 1 && message.length < 12;
  const key = isFirst ? 'GREETING' : (REPLIES[intent] ? intent : 'GENERAL');
  const [text, cta] = REPLIES[key];

  await new Promise((resolve) => setTimeout(resolve, 450));
  return {
    text: JSON.stringify({ message: text, cta, profil: {}, intent: key === 'GREETING' ? 'GENERAL' : key }),
    model: 'demo-local',
    usage: null,
  };
}

export default demoGenerate;
