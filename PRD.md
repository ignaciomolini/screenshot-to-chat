Markdown
# 📄 PRD: OpenCode "Screenshot-to-Chat" Plugin

## 1. Resumen Ejecutivo
**Objetivo:** Desarrollar una extensión para OpenCode que permita al usuario capturar la pantalla (o una región específica) e inyectar automáticamente la imagen resultante como contexto visual en el input nativo del chat de OpenCode, manteniéndolo 100% agnóstico del agente o modelo subyacente.
**Problema a resolver:** Fricción actual al compartir contexto visual. El usuario debe salir del editor, usar una herramienta externa de captura, guardar el archivo y subirlo manualmente al chat.
**Alcance del MVP:** Captura nativa mediante atajo de teclado, conversión a base64/buffer temporal y adjunto automático en la ventana de chat activa de OpenCode.

## 2. Casos de Uso (User Stories)
* **Como desarrollador**, quiero disparar la captura con un atajo de teclado (`Ctrl+S` por defecto) para no tener que sacar las manos del teclado.
* **Como desarrollador**, quiero invocar la captura desde el chat con un slash command (`/screenshot`) para no depender del keybind cuando estoy en un contexto donde no me sirve.
* **Como desarrollador**, quiero que al finalizar la selección, la imagen aparezca instantáneamente en la barra de entrada de texto del panel de IA dentro de OpenCode, lista para enviar junto con mi prompt de texto.
* **Como usuario de OpenCode**, entiendo que la validación de soporte de visión la hace el provider/modelo, no el plugin. La API de OpenCode no expone el modelo activo hasta después de la primera completion, así que el plugin adjunta la imagen y deja que el modelo se encargue: si no soporta visión, el error lo reporta el provider en el response.

## 3. Flujo de Usuario (User Flow)
1. El usuario dispara la captura por cualquiera de los tres medios: keybind (`Ctrl+S`), slash command en el chat (`/screenshot`), o Command Palette (`> Capture Screenshot`).
2. El plugin invoca la herramienta de recorte nativa del sistema operativo (OS native clipping tool).
3. El usuario selecciona el área deseada.
4. El plugin intercepta la imagen capturada en el portapapeles o en un archivo temporal.
5. El plugin codifica la imagen (ej. Base64) y la renderiza como un thumbnail o *attachment* en el input del chat del panel de OpenCode.
6. El usuario escribe su pregunta y presiona Enter.

## 4. Requerimientos Técnicos
* **Entorno:** API de extensiones nativa de OpenCode (presumiblemente basada en arquitectura Node.js/TypeScript).
* **Método de Captura:** Para mantener la extensión ligera, **NO utilizar dependencias pesadas** si no es estrictamente necesario. Preferir el uso del módulo `child_process` para invocar comandos nativos del SO:
    * *macOS:* `screencapture -i`
    * *Windows:* `SnippingTool` o scripts de PowerShell.
    * *Linux:* `gnome-screenshot` o `scrot`.
* **Manejo de Memoria:** Si se usan archivos temporales, implementar una rutina de limpieza (cleanup) al enviar el mensaje o al limpiar el buffer.
* **Integración Multimodal:** El payload generado debe respetar el formato estándar de adjuntos de la API pública de OpenCode.

## 5. Exclusiones (Fuera del alcance del MVP)
Para asegurar una iteración rápida, las siguientes funciones **no** se incluirán en la versión 1.0:
* Herramientas de edición de imagen integradas (dibujar flechas, censurar texto, recortar post-captura).
* Historial de capturas previas (solo se mantiene la captura activa en el input).
* Reconocimiento óptico de caracteres (OCR) local previo al envío. Toda la interpretación visual la hará el modelo LLM remoto.

## 6. Consideraciones de Seguridad y Permisos
* **macOS:** El plugin deberá documentar para el usuario final que OpenCode requerirá permisos de "Grabación de Pantalla" en Preferencias del Sistema.
* **Privacidad:** Las imágenes capturadas nunca deben subirse a servidores de terceros de forma autónoma. Solo se inyectan en el cliente local hasta que el usuario decide enviar explícitamente el mensaje.

## 7. Tareas de Implementación (Para la fase `apply`)
1. Definir la estructura básica del plugin (`package.json`, puntos de entrada, registro de comandos).
2. Implementar el módulo `ScreenshotService` responsable de interactuar con el SO subyacente.
3. Implementar el módulo `ChatInjectionService`. Este servicio debe utilizar estrictamente la API pública de extensiones de OpenCode para insertar adjuntos (attachments) en el panel de chat, sin importar qué framework de agentes esté corriendo por detrás.
4. Escribir el manejador de eventos que ata el comando del usuario con ambos servicios.
