# Seguridad y riesgos — diseño inicial

**Estado:** análisis de amenazas; controles de aplicación no implementados.

| Riesgo | Control propuesto | Comprobación pendiente |
|---|---|---|
| Sobreventa/límite eludido con paralelismo | DB, bloqueos, restricciones, contador usuario/evento | 200/50 y límite concurrente |
| Cobro/ticket duplicado por retry | Claves únicas por actor/operación y hash de payload | Retries simultáneos y payload diferente |
| Precio o rol impuesto por cliente | DTO estricto, precio del servidor, autorización por recurso | Precio manipulado y organizador ajeno |
| Robo/reuso de sesión | Hash de contraseña, refresh hasheado y rotativo, familia revocable | Logout, replay, expiración y carrera refresh |
| Abuso de login/compras | Rate limit documentado y probado; no confiar en cabeceras proxy arbitrarias | Umbrales, reinicio y topología real |
| QR falsificado | Firma del emisor y del titular, codificación canónica, claves públicas confiables | Firmas alteradas, otra clave/evento |
| Captura antigua | Ventana temporal corta y tolerancia explícita | Reloj dentro/fuera de tolerancia |
| Transferencia/reembolso/ingreso concurrentes | Bloquear ticket, releer estado, revocar versión | Carreras y rechazo de entrada usada |
| Doble ingreso offline | Rechazo local + arbitraje central + incidente persistente | Dos puertas desconectadas |
| Manipulación de sync | Autenticación dispositivo/staff, scope, UUID/hash, límites batch | Evento ajeno y UUID reutilizado |
| Alteración de auditoría | Inserción transaccional; rol app sin UPDATE/DELETE ni DDL | Intentar alterar desde credencial app |
| Exposición del dataset | Original externo, salida agregada, no copiar secretos ni PII | Revisión Git y salida del auditor |

## Límites que no se pueden eliminar con criptografía

- Sin comunicación entre puertas no puede impedirse todo doble ingreso físico.
  El servidor impone un solo ingreso **lógico** y conserva ambos intentos.
- Escáner desconectado no conoce revocaciones nuevas. Se requiere política de
  antigüedad máxima de snapshot; sin enunciado no se inventa su duración.
- Una captura dentro de una ventana todavía vigente puede reproducirse. La
  rotación reduce tiempo de exposición, no identifica por sí sola al portador.
- Firma válida no demuestra que el reloj o la base SQLite no hayan sido alterados.
  Se requiere sincronización del reloj, tolerancia y advertencias operativas.
- Dispositivo perdido/comprometido exige revocación y reenrolamiento. El titular
  y el emisor usan claves distintas; nunca se distribuye la privada del emisor.
- Append-only desde el rol de aplicación no impide alteraciones por superusuario
  de PostgreSQL. Restringir credenciales, backups y administración por separado.

## Manejo de secretos y datos aportados

No se han pedido tokens ni se han publicado credenciales. Acceso read-only a Git
funciona con autenticación existente del entorno. El dataset contiene `password`,
`nombre` y `email`; no se ha confirmado que todos sean ficticios. El original
permanece fuera del repositorio y no se usa directamente como semilla pública.

Futura semilla debe generar identidades de demostración y hashes nuevos; no
conservar passwords históricos ni direcciones originales. JWT, clave del emisor
y claves de dispositivos se generan o suministran de forma segura fuera de Git.
`.env.example` incluirá solo nombres y ejemplos no secretos cuando existan
variables reales de la aplicación. No se crea configuración ficticia de momento.

Las claves públicas del emisor deben instalarse por un canal autenticado y
soportar rotación por `kid`; aceptar una clave incluida por el propio QR sería
una vulnerabilidad. Detalles de enrolamiento y recuperación se fijarán antes
del spike móvil, junto con prueba de posesión de la clave del receptor.
