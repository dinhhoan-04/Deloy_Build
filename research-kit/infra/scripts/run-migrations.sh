#!/bin/sh
set -eu

cd /app/backend
exec alembic upgrade head
