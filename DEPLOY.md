# Despliegue Docker

Este proyecto corre el backend Express, sirve el build de React desde el mismo contenedor y usa PostgreSQL local en Docker.

## Servidor

```bash
cd /home/administrator/project_extracted
docker compose up -d --build
```

La app queda publicada en:

```text
http://SERVIDOR:1180
```

## Base de datos

Docker Compose crea una base PostgreSQL local:

```text
Host interno: db
Base: livedata_dashboard
Usuario: dashboard
Puerto PostgreSQL en el servidor: 5444
Puerto expuesto publico de la app: 1180
```

## Datos demo

El backend crea las tablas y siembra datos sinteticos al arrancar. Para sembrar manualmente:

```bash
docker compose restart dashboard
```
