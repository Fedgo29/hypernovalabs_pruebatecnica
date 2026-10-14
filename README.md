# hypernovalabs_pruebatecnica

Prueba técnica de ticketing de eventos y control de acceso de Hypernova Labs.

## Estado actual

**Fase 1: auditoría y diseño inicial; implementación pendiente.** El repositorio
recibido contiene únicamente este README. Se verificaron el remoto, el historial
y las ramas antes de modificarlo. No existen todavía API, portal, aplicación
móvil, migraciones, contenedores del proyecto ni suites de pruebas.

Las instrucciones de dirección técnica y el dataset fueron aportados por el
usuario. Falta `enunciado.html`, declarado fuente de verdad por esas instrucciones.
La matriz y la arquitectura se basan en la dirección técnica disponible y deben
contrastarse con el enunciado antes de cerrar el diseño e implementar.

## Documentación

- [Fuentes y matriz de requisitos](docs/requirements/matrix.md).
- [Arquitectura propuesta](docs/architecture/overview.md).
- [Modelo de datos y transacciones](docs/architecture/data-model.md).
- [Decisiones de arquitectura](docs/adr/README.md).
- [Seguridad y límites offline](docs/security.md).
- [Estrategia de validación](docs/qa/strategy.md).
- [Auditoría del dataset](docs/qa/dataset.md).
- [Informe de la Fase 1](docs/progress/phase-1.md).

## Reproducir la auditoría del dataset

Requiere Python 3.12 o posterior; no necesita dependencias externas:

```sh
python3 scripts/audit-dataset.py /ruta/privada/datos-prueba-ticketing.json
```

El dataset original permanece fuera del repositorio porque contiene contraseñas
en texto, nombres y correos cuya naturaleza sintética no está comprobada. El
script informa estructura, conteos y comprobaciones sin mostrar esos valores.
No importa datos ni cambia el archivo. Véase el informe del dataset para
interpretar resultados y distinguir reglas comprobadas de hipótesis.

## Ejecución y demostración de la aplicación

Pendientes: no hay aplicación ejecutable y no se ha ejecutado ninguna prueba de
negocio. No ejecutar comandos de instalación o `docker compose up` del proyecto
hasta que existan los manifiestos, las migraciones y la configuración validados.

El entorno de auditoría dispone de Node.js, npm, Python, Docker y Docker Compose.
Su disponibilidad no demuestra compatibilidad de NestJS, Expo o criptografía
móvil: estas comprobaciones pertenecen a las siguientes fases.

La implementación prevista debe permitir `docker compose up` desde un clon
limpio e inicializar PostgreSQL, API, portal, migraciones y semillas idempotentes.
Las instrucciones de acceso de Expo desde dispositivo o emulador se añadirán
cuando se pruebe ese flujo. No hay cuentas de demostración ni secretos publicados.
