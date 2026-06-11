const jwt = require('jsonwebtoken');
require('dotenv').config();

const token = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET || 'your-secret-key');

fetch('https://admin.takcakap.com/api/admin/points/users', {
  headers: { 'Authorization': 'Bearer ' + token }
})
.then(r => r.text())
.then(t => console.log('Response:', t))
.catch(console.error);
