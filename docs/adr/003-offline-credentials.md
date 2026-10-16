# ADR 003 — Credencial emisora y posesión rotativa Ed25519

**Estado:** adoptada; protocolo implementado. Compatibilidad en dispositivo Expo pendiente de evidencia real.

**Contexto:** validación sin red, QR antiguo caduca, privada del emisor nunca sale del servidor. Una captura vigente puede reproducirse durante su ventana.

**Alternativas:** QR estático; HMAC compartido; firma emisora sin posesión; credencial ligada a clave titular más prueba temporal local.

**Decisión:** Ed25519 JS con @noble/curves 1.9.7. JSON QR contiene credencial firmada y prueba firmada por titular, con mensajes canónicos ASCII, orden fijo y separación de dominios. Se rechazan campos desconocidos, firmas inválidas y claves sin confianza. Credencial incluye versión, kid, ticket, evento, zona, vigencia y clave pública titular. Slots de 25 segundos: aceptar actual/anterior, nunca futuro; captura máxima menor de 50 segundos. Una captura de 60 segundos se rechaza.

Servidor conserva privada PKCS8/semilla de 32 bytes en runtime; móvil genera semilla de 32 bytes con Expo Crypto CSPRNG y guarda en SecureStore. Escáner recibe claves públicas durante bootstrap autenticado. Transferencia aceptada revoca versión y limpia vínculo de clave para receptor.

**Justificación:** titular puede generar códigos offline sin la privada emisora; escáner usa claves públicas. Biblioteca compartida evita divergir protocolo entre Node y móvil.

**Riesgos:** SecureStore no garantiza clave Ed25519 hardware; semilla pasa por memoria JS. Reloj alterado, QR denso, captura vigente y revocación desconectada. Bootstrap requiere canal TLS confiable fuera de desarrollo. Reenrolamiento/rotación emisora necesitan operación explícita y convivencia de claves: kid por sí solo no acredita gestión completa de rotación.

**Validación:** tests Node verifican lógica del protocolo, pero no cámara, SecureStore ni SQLite móvil. Ejecutar firma/verificación interoperable en Android/iOS, reinicio, lectura QR, densidad, reloj, firma alterada, captura 60 segundos y transferencia. No afirmar compatibilidad nativa por compilación o Metro solamente.
