# GCP: servidor de demostración privado y emulador local

Esta opción mueve PostgreSQL, API y portal a una VM. Expo y Android siguen en Windows. No es un despliegue público con HTTPS: usa un túnel SSH cifrado y conserva las cuentas de demostración fuera de Internet.

## 1. Cuenta, proyecto y presupuesto

1. Entra en <https://console.cloud.google.com/> y crea un proyecto, por ejemplo `hypernova-demo`. Su **ID de proyecto** puede ser distinto del nombre: anótalo.
2. Vincula una cuenta de facturación y habilita la API de Compute Engine cuando la consola lo solicite. Comprueba si tu cuenta tiene créditos; no asumas que la VM será gratuita.
3. En **Facturación → Presupuestos y alertas**, crea un presupuesto con notificaciones. Un presupuesto no limita ni detiene el gasto.

## 2. Crear la VM

En **Compute Engine → Instancias de VM → Crear instancia**:

- Nombre: `hypernova-demo`.
- Región: elige una cercana y anota la zona exacta.
- Tipo: `e2-standard-2` (2 vCPU, 8 GB RAM), para poder construir las imágenes sin depender de la RAM de tu PC.
- Disco de arranque: Debian 12, disco equilibrado de 30 GB.
- Mantén los puertos HTTP/HTTPS cerrados. No crees reglas para 3000, 8080 o PostgreSQL.
- Para esta demo no necesitas permisos de acceso a otros servicios de Google desde la VM.
- Revisa la estimación de coste mostrada por Google antes de crearla. El disco y la IP pueden generar costes adicionales.

Pulsa **SSH** en la instancia para abrir su terminal. Los siguientes comandos son para **esa terminal Linux**, no para PowerShell.

## 3. Instalar Docker y Git

Sigue la instalación oficial para Debian: <https://docs.docker.com/engine/install/debian/>. Para Debian 12:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo docker compose version
```

Necesitas Compose 2.24.4 o posterior. Se usa `sudo docker` para evitar cambiar los grupos del usuario durante la sesión.

## 4. Clonar y arrancar

```bash
git clone --branch main https://github.com/Fedgo29/hypernovalabs_pruebatecnica.git
cd hypernovalabs_pruebatecnica
git log -1 --oneline
sudo docker compose -f docker-compose.yml -f infra/docker/compose.vm.yml up -d --build --wait
sudo docker compose -f docker-compose.yml -f infra/docker/compose.vm.yml ps -a
curl -fsS http://127.0.0.1:3000/v1/readiness
```

La rama `main` contiene la configuración de VM y la documentación de entrega. Si GitHub responde `Repository not found`, comprueba acceso/visibilidad del repositorio y autentícate en la VM mediante GitHub CLI; no pegues tokens en comandos ni en el chat.

Es normal que `secrets` e `initialize` terminen con código 0. API, portal y PostgreSQL deben quedar saludables. Si falla:

```bash
sudo docker compose -f docker-compose.yml -f infra/docker/compose.vm.yml logs --tail=100 initialize api admin
```

No compartas credenciales que aparezcan en archivos locales. La VM tiene una base nueva y genera sus propias claves y contraseña de demostración: tus compras locales no se copian automáticamente.

## 5. Conectar Windows por SSH

Instala Google Cloud CLI desde <https://cloud.google.com/sdk/docs/install>. Abre una **nueva ventana de PowerShell** y autentica tu propia cuenta:

```powershell
gcloud init
gcloud config set project TU_ID_DE_PROYECTO
gcloud compute ssh hypernova-demo --zone TU_ZONA -- -N -L 3000:127.0.0.1:3000 -L 8080:127.0.0.1:8080
```

Sustituye los dos valores en mayúsculas. El comando SSH permanece abierto: es el túnel. Si solicita crear una clave SSH local, sigue el diálogo de Google Cloud CLI. Las políticas de tu proyecto deben permitir tu acceso SSH; si indica un error, conserva el mensaje sin incluir claves ni tokens para diagnosticarlo.

Antes de abrir el túnel, apaga **solo tu stack local** desde otra PowerShell en la carpeta del proyecto para liberar los puertos y la memoria:

```powershell
docker compose down
```

No añadas `-v`: conservarás los datos locales. También puedes detener Docker Desktop cuando ya no lo necesites.

Con el túnel abierto:

- Portal en Windows: <http://localhost:8080>.
- API en Windows: <http://localhost:3000/v1/readiness>.
- En `apps/mobile/.env`: `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/v1`.
- Reinicia Expo si cambiaste esa variable. Ejecuta `npm run dev:mobile` desde la carpeta del repositorio local.

`10.0.2.2` apunta al PC anfitrión del emulador Android; el túnel reenvía la conexión a GCP. No pongas la IP pública de la VM en la app para este esquema.

## 6. Acceso y prueba

En la terminal SSH de la VM, consulta **en privado** la contraseña de esa instalación:

```bash
sudo docker compose exec -T api cat /app/runtime/demo-credentials.json
```

Entra al portal con `admin.101@example.test` y esa contraseña. En Android puedes registrar un asistente nuevo o usar uno de la semilla. No uses contraseñas ni entradas emitidas por tu instalación local esperando que funcionen en la nueva.

Verifica una compra, la billetera y el inicio de turno del escáner. Los escáneres deben sincronizar con la nueva instalación antes de probar modo avión. Para la prueba offline, desactiva también Wi-Fi en los emuladores; el túnel debe permanecer disponible para sincronizar después.

## 7. Detener y conservar

- `Ctrl+C` en el túnel solo cierra la conexión; **no detiene la VM ni sus costes**.
- Detén la VM en Compute Engine cuando no la uses. El disco conservado sigue teniendo coste; revisa también las tarifas de IP.
- No ejecutes `docker compose down -v`: elimina volúmenes, incluyendo datos y claves de las entradas.
- Para volver: inicia la VM, abre el túnel y comprueba readiness. Los servicios tienen reinicio automático; los datos y claves permanecen en los volúmenes del disco.
- Antes de borrar la VM o su disco, guarda una copia privada de la base y los volúmenes de claves si necesitas conservar la instalación. Borrar todo sin copia pierde las entradas.

Para una entrega pública con HTTPS se necesita otra configuración: dominio, certificado, revisión de usuarios de demo, copias de seguridad y exposición controlada. Esta guía resuelve la demo privada y el consumo local de Docker. La configuración Compose se puede validar localmente; el despliegue real requiere completar la cuenta y comprobar el acceso SSH de GCP.
