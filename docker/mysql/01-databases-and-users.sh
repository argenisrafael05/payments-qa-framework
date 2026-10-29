#!/bin/bash
set -eu

# One database per region. PayRef writes with its user, and the framework can only read.
mysql --protocol=socket -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE payref_mx;
CREATE DATABASE payref_sa;

CREATE USER '$PAYREF_DB_USER'@'%' IDENTIFIED BY '$PAYREF_DB_PASSWORD';
GRANT ALL PRIVILEGES ON payref_mx.* TO '$PAYREF_DB_USER'@'%';
GRANT ALL PRIVILEGES ON payref_sa.* TO '$PAYREF_DB_USER'@'%';

CREATE USER '$QA_DB_USER'@'%' IDENTIFIED BY '$QA_DB_PASSWORD';
GRANT SELECT ON payref_mx.* TO '$QA_DB_USER'@'%';
GRANT SELECT ON payref_sa.* TO '$QA_DB_USER'@'%';
SQL
