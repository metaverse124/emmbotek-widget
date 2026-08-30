/**
 * Atrapa modelu na potrzeby dema i testow manualnych (bez klucza Gemini).
 * Zwraca poprawny kontrakt: [EMOCJA] + tresc + ewentualne CTA,
 * zeby mozna bylo zobaczyc caly UX widgetu i animacje awatara.
 */
import { detectIntent } from '../src/agent/intents.js';

const REPLIES = {
  GREETING: ['[GREETING] Dzień dobry! W czym mogę dziś pomóc?', []],
  PRICE: ['[NEUTRAL] Aktualne stawki różnią się w zależności od trybu i liczby osób w grupie, dlatego podaję je zawsze z cennika, a nie z pamięci. Zajrzy Pan/Pani do aktualnej tabeli?', [{ type: 'VIEW_PRICE' }]],
  CHILD: ['[SMILE] Dla dziewięciolatki najlepiej sprawdzają się zajęcia w kameralnej grupie rówieśników — dzieci uczą się tam przez zabawę i mówienie, a nie przez ciszę przy tablicy. Czy córka miała już wcześniej kontakt z angielskim?', [{ type: 'VIEW_FOR_CHILDREN' }]],
  COMPANY: ['[FOCUS] Dla firm układamy program pod realne sytuacje zawodowe zespołu — spotkania, mejle, prezentacje. Ilu pracowników miałoby uczestniczyć w szkoleniu?', [{ type: 'VIEW_FOR_COMPANIES' }]],
  EXAM: ['[PROUD] Przygotowujemy do FCE, CAE, IELTS i TOEFL. Kluczowe jest ustalenie punktu startowego — czy zna Pan/Pani swój obecny poziom?', [{ type: 'VIEW_EXAM' }, { type: 'LEVEL_TEST' }]],
  TRIAL_LESSON: ['[EXCITED] Bezpłatna lekcja próbna to najprostszy sposób, żeby sprawdzić grupę bez zobowiązań. Umówi się Pan/Pani na termin?', [{ type: 'TRIAL_LESSON' }]],
  LANGUAGE_QUESTION: ['[FOCUS] „Nevertheless" znaczy „niemniej jednak" i łączy dwa zdania mimo przeciwnego sensu: "It was raining; nevertheless, we went out." W mowie brzmi formalnie — w rozmowie częściej usłyszy Pan/Pani „still" albo „anyway".', []],
  CONTACT: ['[NEUTRAL] Najszybciej pomoże sekretariat — tam są aktualne terminy i wolne miejsca.', [{ type: 'CONTACT' }]],
  GENERAL: ['[CURIOUS] Chętnie pomogę dobrać kurs. Dla kogo szukamy zajęć — dla dziecka, dla siebie czy dla zespołu w firmie?', []],
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
