# Seguridad y límites operativos

**Estado:** controles presentes en código y SQL. Una revisión estática no demuestra todos los escenarios: consultar resultados ejecutados en `docs/qa/`, distinguiendo pendiente y probado.

## Amenazas y controles

| Riesgo | Control implementado | Verificación requerida |
|---|---|---|
| Sobreventa/límite bajo paralelismo | Bloqueos DB, CHECK y contador usuario/evento | 200/50 y reconciliación SQL; límite concurrente |
| Compra/cargo duplicado | Advisory lock + PK idempotente, hash payload, ledger único | Misma clave concurrente, distinto payload y distintas claves |
| Precio o rol impuestos por cliente | Precio de fase del servidor; registro siempre asistente; autorización por recurso | Precio manipulado y organizador ajeno |
| Robo/replay de sesión | scrypt con salt; refresh SHA-256, rotación y revocación de familia | Logout, replay y carrera refresh/logout |
| Token de acceso tras revocación | JWT HS256 con algoritmo/issuer/audience fijos y sesión activa consultada en DB | Acceso después de logout/refresh |
| Abuso de login/compras | Rate limit por instancia: login 300/min/IP, registro 10; compras 100/min/usuario | Umbral/429; proxy real y limitación horizontal pendiente |
| QR falso | Firmas Ed25519 emisor/titular, formato estricto y claves bootstrap | Otra clave, firma alterada, evento/zona ajenos |
| Captura antigua | Slot 15 s, solo actual/anterior | Captura 60 s y bordes de slot/reloj |
| Transferencia/reembolso/ingreso simultáneo | Bloqueo ticket, relectura de estado, revocación versionada | Carreras y reembolso de usada |
| Doble ingreso desconectado | Rechazo SQLite local; admisión central única e incidente | Dos puertas y replay persistente |
| Sync alterado | Staff/dispositivo/scope, UUID/hash, batch≤500 | Evento ajeno, dispositivo revocado, UUID cambiado |
| Auditoría alterada desde aplicación | Rol runtime sin UPDATE/DELETE; triggers append-only | Intentos SQL con rol runtime |
| Dataset expuesto | Copia sanitizada; original externo; passwords nuevos | Auditoría sanitización y revisión de Git |

Contraseñas se derivan con scrypt N=32768, r=8, p=1 y salt aleatorio de 24 bytes. Refresh aleatorio solo se persiste hasheado; acceso dura hasta 15 minutos y familia hasta 7 días. Refresh consumido revoca sucesores al detectar replay; la revocación se confirma antes de devolver error. Dos refresh simultáneos pueden cerrar familia deliberadamente: los clientes deben serializar renovación.

## Confianza y secretos

JWT, clave privada emisora y contraseña demo se generan aleatoriamente fuera de Git o llegan por variables. Compose guarda secretos en volumen privado y mantiene un rol owner separado del rol runtime. No registrar tokens, claves, passwords ni URLs de DB con credenciales. Datos originales con nombre/email/password no se publican; la semilla tiene identidades sanitizadas y password runtime nuevo. No atribuir carácter ficticio a los originales sin evidencia.

La privada emisora nunca se distribuye a las apps. SecureStore conserva semilla del titular; Expo Crypto genera 32 bytes aleatorios. SecureStore no acredita hardware ni evita extracción en dispositivo comprometido. Pérdida de teléfono exige cambiar clave/revocar versión mediante sesión autorizada. Kid identifica la clave pública; su bootstrap debe usar TLS y origen confiable en producción. Desarrollo HTTP local no ofrece confidencialidad ni protección de intermediario y no debe exponerse como despliegue público.

Clave desconocida, campos extra, codificación ambigua, firma inválida y QR con clave autoproclamada no otorgan confianza. El tamaño de token se limita a 8192 caracteres. El QR lleva dos firmas y puede ser denso: medir lectura en cámara real y no prometer usabilidad por prueba Node.

## Límites del modo offline

- Sin comunicación entre puertas no puede impedirse todo doble ingreso físico. Se impone un solo ingreso **lógico** y se conservan intentos/incidente al sincronizar.
- Escáner desconectado ignora revocaciones nuevas. Transferencia, cambio de clave, devolución o anulación se conocen al descargar revocaciones; no prometen invalidación inmediata offline.
- Una captura válida puede reproducirse dentro del slot actual/anterior, menos de 30 segundos. Rotación no identifica físicamente al portador ni autentica una cámara.
- El reloj y el SQLite de un dispositivo comprometido no son confiables. La verificación en sync usa tiempo declarado y lo conserva como no confiable; criptografía no demuestra cuándo ocurrió el ingreso.
- Backend limita antigüedad de intento por defecto a 72 horas y futuro declarado a 60 segundos, además del turno. Cliente calibra con `serverTime`, rechaza desfase superior a 60 segundos al preparar/sincronizar y bloquea snapshot vencido tanto en UI como en persistencia. Usa tiempo declarado/calibrado y no demuestra integridad del reloj cuando queda offline; validar la política en dispositivo.
- Reembolso antes de llegada de un acceso offline puede devolver cupo aunque haya ocurrido entrada física. La reconciliación debe conservar el conflicto, sin borrar historia ni pretender recuperar el acceso físico.
- Revocar dispositivo/staff bloquea sync autorizado posterior; recuperar evidencia pendiente de un dispositivo revocado requiere procedimiento administrativo, no borrar su cola.

## Protección de evidencia y despliegue

Intentos, admisiones, incidentes y auditoría central no pueden actualizarse/eliminarse con el rol runtime. El superusuario o propietario de DB aún puede cambiar triggers/roles; separar administración, mantener backups y controlar esos accesos. Esta entrega no afirma evidencia con sellado externo ni resistencia a un administrador de DB malicioso.

Compose ejecuta migraciones y semilla en el job `initialize`, con credenciales owner. La API arranca después con UID 1000 y rol SQL `hypernova_app`; solo monta los secretos de aplicación. La contraseña owner queda en un volumen distinto que la API no monta. El job termina y transfiere al UID 1000 los archivos de runtime. El arranque local fuera de Compose puede inicializar la base cuando se suministra `DATABASE_ADMIN_URL`; ese flujo de desarrollo no sustituye el aislamiento del despliegue. El administrador del host o de Docker mantiene acceso privilegiado a los volúmenes.

Rate limiting en memoria se reinicia con el proceso y se divide entre instancias. Concurrencia comercial depende de SQL y mantiene sus controles pese a ese límite. Antes de desplegar públicamente: TLS, orígenes CORS definidos, operación de rotación/recuperación de claves, límites de proxy y revisión de retención de PII/evidencia. Estos son requisitos operativos documentados, no una declaración de validación de producción.
