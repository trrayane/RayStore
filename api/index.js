const app = require('../server');
const { ready } = require('../db');

module.exports = async (req, res) => {
  await ready;
  return app(req, res);
};
