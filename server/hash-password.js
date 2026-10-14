// usage: node hash-password.js 'your password'  -> prints a bcrypt hash for config.json
const bcrypt = require('bcryptjs'); const p = process.argv[2];
if (!p || p.length < 10) { console.error('Use a password of at least 10 characters.'); process.exit(1); }
console.log(bcrypt.hashSync(p, 12));
