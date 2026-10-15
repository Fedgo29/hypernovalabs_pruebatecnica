# Informe al Director Técnico — implementación y validación

Ejecución del 14 de octubre de 2026 (America/Bogota). Los informes JSON conservan
las horas originales UTC del 15 de octubre. El commit `45e3d17` del usuario
conservó la implementación; los ajustes posteriores preservan ese trabajo.

## Fase 2 — backend e invariantes de compra

**Objetivo:** preparar la API, PostgreSQL, identidad, inventario, precio,
reservas, pagos simulados y permisos antes de depender de las interfaces.

**Trabajo realizado:** módulos NestJS, cuatro migraciones, seed sanitizada,
roles SQL, transacciones de compra, sesiones rotativas y ledger. Corregidos
permisos de imagen para UID 1000 y healthcheck del portal detrás del proxy.

**Decisiones:** PostgreSQL como autoridad; bloqueos por zona y cuenta/evento,
idempotencia durable y precio fijado al reservar. Expiración persistente de
600 segundos, recuperación tras reinicio y consulta a demanda. Un pago que
espera un bloqueo usa la hora posterior al bloqueo; si venció se reembolsa de
forma simulada sin ticket. Reembolso devuelve cupo. Inicialización separada de
la API, que no monta el secreto owner.

**Validación:** build estricto; 18/18 pruebas API/integración con DB real;
200 compradores concurrentes, 50 tickets y cargos, 150 SOLD_OUT, cero errores
inesperados ni reservas residuales. p95 reserva 908,52 ms y pago 686,62 ms.
500 lecturas de disponibilidad correctas. EXPLAIN real de cuatro consultas.

**Hallazgos:** el harness inicialmente seleccionó una cuenta nueva cuya
contraseña no era la demo; se restringió a IDs de semilla y se repitió. El rate
limit es por proceso, coherente con la única API desplegada. Las métricas son
locales y no constituyen un SLA.

**Estado:** completada para el backend implementado y los escenarios ejecutados.

**Próximo paso:** validar clientes, despliegue reproducible y límites offline.

## Fase 3 — credenciales, móvil y portal

**Objetivo:** conectar interfaces reales, credenciales rotativas y sincronización
con incidentes auditables.

**Trabajo realizado:** portal React, app Expo asistente/escáner, contratos
Ed25519, almacenamiento SQLite y SecureStore, turnos, UUID por intento,
revocaciones incrementales y arbitraje central por ticket/evento.

**Decisiones:** firma emisora vinculada a clave del titular y prueba de posesión
cada 15 segundos. Rechazo local persistente y un ingreso lógico central; dos
puertas offline pueden admitir físicamente dos veces, por lo que se conserva
el intento conflictivo y se muestra un incidente. No se oculta ni elimina.

**Validación:** 7/7 pruebas criptográficas y 5/5 de sesiones web; exportación
Android/iOS y bytecode Hermes compilados; typecheck móvil aprobado. Portal
construido comprobado en Chromium con 18 pasos reales, sin errores JS, consola
o respuestas API fallidas; vistas de 1440 y 390 px inspeccionadas. Integración
verifica transferencia, revocación, QR antiguo y dos dispositivos de protocolo.

**Hallazgos:** el compilador Hermes instalado no ejecuta JavaScript (`-exec` no
soportado). No existe emulador/dispositivo conectado. Las pruebas del protocolo
no validan cámara, persistencia SQLite nativa, SecureStore, dos teléfonos en modo
avión ni la ejecución nativa de la criptografía.

**Estado:** parcialmente completada: interfaces y protocolo implementados;
validación nativa pendiente.

**Próximo paso:** ejecutar las instrucciones de `apps/mobile/README.md` en
dispositivo/emulador compatible y conservar la evidencia nativa.

## Fase 4 — reproducibilidad y entrega

**Objetivo:** entregar arranque, pruebas, documentación y cambios revisables.

**Trabajo realizado:** Compose con inicialización automática y secretos aleatorios,
adaptador de proxy/CA de nube, README completo, reportes JSON, EXPLAIN y capturas.
La solicitud posterior del usuario autoriza hacer push de la rama de desarrollo.

**Decisiones:** conservar la semántica del dataset con identidades sanitizadas,
mapear IDs por rol y mantener un ancla temporal estable. No guardar contraseñas
o claves utilizables por defecto ni publicar el dataset original.

**Validación:** clon local limpio del commit `9a8acfd`, sin dependencias o salidas
generadas, construido con el adaptador de esta nube y volúmenes nuevos. API,
portal y PostgreSQL saludables; 616 usuarios, 3899 tickets y zona 8 con 50
disponibles. Segunda ejecución de inicialización conservó conteos y ancla.
La red pública por defecto de Docker no se probó en esta máquina con proxy.

`npm audit` de producción API/portal: cero avisos. Workspace completo: 35 avisos
(23 altos, 12 moderados), principalmente tooling Expo/Metro; no se ocultaron ni
se aplicaron downgrades incompatibles. Ver `docs/qa/dependencies.json`.

**Hallazgos:** faltan video/GIF de dos escáneres nativos y build instalable
preferido. No se han implementado bonus. La publicación del entorno de nube
corresponde al producto y no se confunde con hacer push al repositorio.

**Estado:** entrega de código y evidencia del backend/portal preparada; entrega
nativa completa pendiente de los ensayos y video anteriores.

**Próximo paso:** revisar los informes, ejecutar la validación nativa y grabar
los flujos completos. El push se verifica por igualdad de SHA local/remoto.
