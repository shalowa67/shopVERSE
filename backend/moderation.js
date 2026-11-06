// Blocks listings and shops that advertise illegal drugs.
//
// Two kinds of terms:
// - DISTINCT terms are long and unambiguous, so they are also matched with spaces, dots
//   and dashes removed (catches "c o c a i n e", "co-caine").
// - WORD terms are short or have innocent uses in other words, so they must appear as a
//   whole word ("weed" blocks "selling weed" but not "seaweed" or "weed killer").
// Common look-alike characters are normalised first (c0caine, w33d, h3roin).

const DISTINCT_TERMS = [
  'cocaine', 'kokain', 'methamphetamine', 'marijuana', 'marihuana',
  'cannabis', 'mandrax', 'fentanyl', 'ketamine', 'psilocybin', 'magicmushroom', 'hashoil'
];

// "heroin" is a whole word so "heroine" (a female hero) is allowed.
const WORD_TERMS = [
  'heroin', 'weed', 'dagga', 'ganja', 'chamba', 'bhang', 'kush', 'meth', 'mdma', 'lsd', 'thc',
  'hashish', 'opium', 'crack cocaine', 'ecstasy pill', 'ecstasy pills', 'ecstasy tablet',
  'ecstasy tablets', 'pre roll', 'pre rolls', 'preroll', 'prerolls', 'blunts'
];

// "weed" followed by one of these is a garden product, not a drug.
const WEED_SAFE_FOLLOWERS = ['killer', 'killers', 'eater', 'eaters', 'trimmer', 'trimmers', 'control', 'barrier', 'mat', 'fabric', 'remover', 'whacker', 'puller', 'cutter', 'membrane'];

const LOOKALIKES = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', '$': 's', '!': 'i', '|': 'i' };

const normalise = (text) => String(text || '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[013457@$!|]/g, (character) => LOOKALIKES[character]);

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wordPattern = new RegExp(
  `(?:^|[^a-z])(${WORD_TERMS.map((term) => escapeRegex(term).replace(/ /g, '[\\s._-]*')).join('|')})(?=$|[^a-z])`,
  'g'
);

// Returns the first prohibited term found in any of the given texts, or null.
const findProhibited = (...texts) => {
  for (const raw of texts) {
    const text = normalise(raw);
    if (!text) continue;

    const squashed = text.replace(/[^a-z]/g, '');
    const distinct = DISTINCT_TERMS.find((term) => squashed.includes(term));
    if (distinct) return distinct;

    wordPattern.lastIndex = 0;
    let match;
    while ((match = wordPattern.exec(text)) !== null) {
      const term = match[1].replace(/[\s._-]+/g, ' ');
      if (term === 'weed') {
        const after = text.slice(match.index + match[0].length).trimStart().split(/[^a-z]+/)[0];
        if (WEED_SAFE_FOLLOWERS.includes(after)) continue;
      }
      return term;
    }
  }
  return null;
};

const PROHIBITED_MESSAGE = (term) =>
  `This can't be listed: it appears to mention a prohibited item ("${term}"). Illegal drugs cannot be sold or advertised on ShopVerse. ` +
  'If this is a mistake, change the wording or contact ShopVerse support.';

module.exports = { findProhibited, PROHIBITED_MESSAGE };
