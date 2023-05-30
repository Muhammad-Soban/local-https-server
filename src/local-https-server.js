const cors = require('cors');
const express = require('express');
const forge = require('node-forge');
const fs = require('fs');
const http = require('http');
const https = require('https');
const minimist = require('minimist');
const morgan = require('morgan');
const os = require('os');
const path = require('path');
const serveIndex = require('serve-index');

const argv = minimist(process.argv.slice(2), {
  default: { host: 'localhost', port: 4443, S: true, tls: true },
  alias: {
    tls: 'ssl',
  },
});

// Display help message and exit if requested
if (argv.h || argv.help) {
  console.log(
    [
      'Usage: local-https-server [path] [options]',
      '',
      'Options:',
      '-a --host       Specify the host address (default: localhost)',
      '-p --port       Specify the port number (default: 4443)',
      '-S --tls --ssl  Enable secure request serving with TLS/SSL (HTTPS) (default: true)',
      '-C --cert       Specify the path to the TLS cert file',
      '-K --key        Specify the path to the TLS key file',
      '-h --help       Display this list of options and exit',
      '-v --version    Display the version and exit',
    ].join('\n')
  );
  process.exit();
}

const port = argv.p || argv.port;
const host = argv.a || argv.host;
const staticFolder = argv._[0] || '.';
const tls = ![argv.S, argv.tls].some((arg) => arg.toString() === 'false');
const sslPassphrase = process.env.NODE_HTTP_SERVER_SSL_PASSPHRASE;
const cert = argv.C || argv.cert;
const key = argv.K || argv.key;
const version = argv.v || argv.version;

// Display version and exit if requested
if (version) {
  console.info('v' + require('../package.json').version);
  process.exit();
}

/**
 * Generate a self-signed SSL certificate using the specified host.
 * @param {string} host The host for which the certificate is generated.
 * @returns {Object} An object containing the paths of the generated certificate and private key files.
 */
function generateCertificate({ host }) {
  // Generate a new private key
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // Create a new certificate
  const cert = forge.pki.createCertificate();

  // Set the certificate attributes
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [
    { name: 'commonName', value: host },
    { name: 'organizationName', value: 'local-https-server' },
    { shortName: 'OU', value: 'local-https-server' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true },
    {
      name: 'keyUsage',
      keyCertSign: true,
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: true,
      dataEncipherment: true,
    },
    { name: 'subjectAltName', altNames: [{ type: 2, value: host }] },
    { name: 'subjectKeyIdentifier' },
  ]);

  // Sign the certificate with the private key
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Convert the certificate and private key to PEM format
  const pemCertificate = forge.pki.certificateToPem(cert);
  const pemPrivateKey = forge.pki.privateKeyToPem(keys.privateKey);

  // Save the certificate and private key to temporary files
  const tempDir = os.tmpdir();
  const certificatePath = path.join(tempDir, 'certificate.pem');
  const privateKeyPath = path.join(tempDir, 'privatekey.pem');
  fs.writeFileSync(certificatePath, pemCertificate);
  fs.writeFileSync(privateKeyPath, pemPrivateKey);
  console.log(`Self-signed SSL certificate created at ${tempDir}`);

  return {
    certificatePath,
    privateKeyPath,
  };
}

const app = express();

// Enable Cross-Origin Resource Sharing (CORS)
app.use(cors());

// Enable HTTP request logging with the 'dev' format
app.use(morgan('dev'));

// Serve static files from the specified public folder
app.use(express.static(staticFolder));

// Serve directory listing with icons for the public folder
app.use(serveIndex(staticFolder, { icons: true }));

let server;

if (tls) {
  // Generate the SSL certificate if not passed as a command-line argument
  let certificatePath;
  let privateKeyPath;

  if (!cert || !key) {
    // Generate a self-signed SSL certificate
    const { certificatePath: certPath, privateKeyPath: keyPath } = generateCertificate({ host });
    certificatePath = certPath;
    privateKeyPath = keyPath;
  } else {
    // Use the provided SSL certificate and key
    certificatePath = cert;
    privateKeyPath = key;
  }

  const options = {
    key: fs.readFileSync(privateKeyPath),
    cert: fs.readFileSync(certificatePath),
    passphrase: sslPassphrase,
  };

  // Create an HTTPS server with the provided SSL options
  server = https.createServer(options, app);
} else {
  // Create an HTTP server
  server = http.createServer(app);
}

// Start the server and listen on the specified host and port
server.listen(port, host, () => {
  const protocol = tls ? 'https' : 'http';
  console.log(`Server running at ${protocol}://${host}:${port}/`);
});
