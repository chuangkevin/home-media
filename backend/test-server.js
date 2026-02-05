const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Hello World');
});

server.listen(3001, '0.0.0.0', () => {
  console.log('✅ Test server listening on port 3001');
});

server.on('error', (error) => {
  console.error('❌ Error:', error);
});

console.log('📌 After server.listen');
