'use strict';

const ALLOWED_TOKENS = new Set(['title', 'artist', 'album', 'albumArtist', 'date', 'trackNumber', 'discNumber', 'genre']);

function validateTemplate(template) {
  if (typeof template !== 'string' || !template.trim() || template.length > 240) {
    throw Object.assign(new Error('Enter a rename template.'), { code: 'INVALID_TEMPLATE' });
  }
  const tokens = [...template.matchAll(/\{([A-Za-z]+)(?::(\d+))?\}/g)];
  for (const [, name, width] of tokens) {
    if (!ALLOWED_TOKENS.has(name) || (width && Number(width) > 8)) {
      throw Object.assign(new Error(`Unknown or invalid rename token: ${name}`), { code: 'INVALID_TEMPLATE' });
    }
  }
  const withoutTokens = template.replace(/\{([A-Za-z]+)(?::(\d+))?\}/g, '');
  if (/[{}]/.test(withoutTokens)) throw Object.assign(new Error('Rename template contains unmatched braces.'), { code: 'INVALID_TEMPLATE' });
  return template;
}

module.exports = { validateTemplate };
