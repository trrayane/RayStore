const { v4: uuidv4 } = require('uuid');

function generateRef() {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CMD-${ts.slice(-4)}${rnd}`;
}

function generateId() {
  return uuidv4();
}

function slugify(str = '') {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

module.exports = { generateRef, generateId, slugify };
