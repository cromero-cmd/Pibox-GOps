#!/usr/bin/env bash
# ═══════════════════════════════════════════
# bump_version.sh — cache-busting + recarga automática para el pipeline
# TADA → Trump · Pibox
#
# Hace dos cosas:
#   1. Agrega/actualiza un query param ?v=VERSION al <script type="module">
#      de index.html — cada vez que el hash cambia, el navegador ve una URL
#      nueva para js/main.js y descarta cualquier copia cacheada en una
#      carga de página NUEVA.
#   2. Escribe version.json con la misma VERSION — js/version-check.js lo
#      consulta cada 5 minutos desde pestañas YA ABIERTAS y se recarga solo
#      si detecta un cambio. Esto es necesario porque (1) por sí solo no
#      alcanza: una pestaña que ya cargó los módulos ES los mantiene en
#      memoria hasta que ella misma dispare un reload — ningún mecanismo de
#      caché (headers HTTP, Service Worker, import maps) puede alcanzar
#      código que ya está corriendo. Ver commit que introduce version-check.js
#      para la evaluación completa de alternativas.
#
# NOTA: deliberadamente NO se versionan los imports estáticos internos
# entre módulos (import {...} from './parser.js', etc. dentro de js/*.js).
# Node y el navegador tratan una misma ruta con distinto query string como
# un módulo DISTINTO (instancia separada, sin estado compartido) — eso
# rompería el patrón de estado compartido entre módulos (mallaRaw, tadaNorm,
# concResult, etc.) del que depende todo el pipeline, y desincroniza los
# tests (que importan js/*.js con rutas sin versionar).
#
# Uso: ejecutar antes de cada commit que se vaya a publicar.
#   ./bump_version.sh
# ═══════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(date +%Y%m%d%H%M)

tmp="$(mktemp)"
sed -E "s#(src=\"js/main\.js)(\?v=[0-9]+)?\"#\1?v=${VERSION}\"#" index.html > "$tmp"
mv "$tmp" index.html

printf '{"version":"%s"}\n' "$VERSION" > version.json

echo "✓ Versión ${VERSION} aplicada a index.html (js/main.js?v=${VERSION}) y version.json"
