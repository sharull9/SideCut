# Local TLS fixture

`localhost-cert.pem` and `localhost-key.pem` are a public test certificate and private key for loopback integration checks. They have no production identity or credentials. The certificate covers `localhost` and `127.0.0.1`; the mismatch test connects through `127.0.0.2`. Its validity begins on 2026-10-30 and lasts ten years.

The fixture CA is supplied only to the test recorder. It is never installed into an OS trust store or included in production host configuration.

Regenerate the pair with OpenSSL:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout tests/fixtures/streaming/localhost-key.pem -out tests/fixtures/streaming/localhost-cert.pem -days 3650 -subj /CN=localhost -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
```
