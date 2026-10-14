# ADR 003 — Credencial del emisor y posesión rotativa

**Estado:** propuesta; compatibilidad Expo/Ed25519 pendiente de ejecutar.

**Contexto:** escáner valida sin red, QR antiguo debe caducar y móvil no recibe
la clave privada del emisor. Una captura nunca puede impedirse por completo
dentro de su propia ventana de validez.

**Alternativas:** QR estático; secreto HMAC compartido con escáneres; firma del
emisor sin posesión; credencial del emisor vinculada a clave del titular más
prueba temporal firmada por el dispositivo.

**Decisión:** proponer Ed25519 con dos firmas y separación de dominios. Credencial
incluye identificador del emisor, ticket/evento, versión, vigencia y clave pública
del titular. Prueba incluye hash de credencial, ventana temporal y contexto del
protocolo. Codificación canónica y rechazo de campos/algoritmos desconocidos.

**Justificación:** el titular crea códigos nuevos sin obtener la privada del
servidor; el escáner requiere solo claves públicas. Cambiar titular revoca la
versión previa y vincula la credencial al dispositivo del receptor.

**Riesgos:** almacenamiento local de la privada del titular, dispositivo
comprometido, tamaño del QR, reloj manipulado y revocación desactualizada. Un
QR vigente copiado puede reproducirse en otra puerta offline. No se promete
prevención global offline; se detecta y audita al sincronizar. Expo SecureStore
no garantiza por sí solo una clave Ed25519 hardware ni prueba soporte criptográfico.

**Validación:** spike pendiente en plataforma móvil seleccionada: generación
con CSPRNG, firma/verificación interoperable servidor/móvil, persistencia segura,
reinicio, lectura QR, límites de tamaño, reloj, firma alterada y captura antigua.
Biblioteca y versiones no se darán por compatibles por pasar solo pruebas Node.
